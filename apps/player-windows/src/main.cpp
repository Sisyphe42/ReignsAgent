#include <windows.h>
#include <bcrypt.h>
#include <shlobj.h>
#include <shellapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <winrt/base.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <limits>
#include <map>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using winrt::Windows::Data::Json::JsonObject;

namespace {
constexpr std::array<char, 16> kFooterMagic = {'R','E','I','G','N','S','A','G','E','N','T','R','E','L','1','!'};
constexpr std::uint32_t kPayloadVersion = 1;
constexpr std::uint32_t kFooterSize = 72;
constexpr wchar_t kWindowClass[] = L"ReignsAgentPlayerWindow";
constexpr wchar_t kVirtualOrigin[] = L"https://reignsagent.local/";

bool IsExternalHttpUrl(const wchar_t* uri) {
  if (!uri) return false;
  return _wcsnicmp(uri, L"https://", 8) == 0 || _wcsnicmp(uri, L"http://", 7) == 0;
}

#pragma pack(push, 1)
struct PayloadFooter {
  char magic[16];
  std::uint32_t version;
  std::uint64_t manifestLength;
  std::uint64_t filesLength;
  unsigned char payloadHash[32];
  std::uint32_t footerSize;
};
#pragma pack(pop)
static_assert(sizeof(PayloadFooter) == kFooterSize);

struct FileEntry {
  std::filesystem::path relativePath;
  std::uint64_t offset;
  std::uint64_t length;
  std::array<unsigned char, 32> hash;
};

struct ReleasePayload {
  std::wstring projectId;
  std::wstring buildId;
  std::wstring title;
  std::wstring entry;
  std::uint64_t fileRegionOffset;
  std::vector<FileEntry> files;
  std::vector<unsigned char> executable;
};

ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
std::filesystem::path g_extractRoot;
bool g_smoke = false;
std::wstring g_smokeSummary;

std::wstring Utf8ToWide(std::span<const unsigned char> bytes) {
  if (bytes.empty()) return {};
  if (bytes.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) throw std::runtime_error("UTF-8 input is too large");
  const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
    reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
  if (length <= 0) throw std::runtime_error("Manifest is not valid UTF-8");
  std::wstring value(static_cast<std::size_t>(length), L'\0');
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
    reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), value.data(), length)) {
    throw std::runtime_error("Manifest UTF-8 conversion failed");
  }
  return value;
}

std::array<unsigned char, 32> Sha256(std::span<const unsigned char> bytes) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD objectLength = 0;
  DWORD returned = 0;
  std::array<unsigned char, 32> digest{};
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) throw std::runtime_error("SHA-256 provider failed");
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength), sizeof(objectLength), &returned, 0) < 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw std::runtime_error("SHA-256 object length failed");
  }
  std::vector<unsigned char> object(objectLength);
  bool failed = BCryptCreateHash(algorithm, &hash, object.data(), objectLength, nullptr, 0, 0) < 0;
  for (std::size_t offset = 0; !failed && offset < bytes.size();) {
    const auto remaining = bytes.size() - offset;
    const auto chunk = static_cast<ULONG>(std::min<std::size_t>(remaining, std::numeric_limits<ULONG>::max()));
    failed = BCryptHashData(hash, const_cast<PUCHAR>(bytes.data() + offset), chunk, 0) < 0;
    offset += chunk;
  }
  if (failed || BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) < 0) {
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw std::runtime_error("SHA-256 calculation failed");
  }
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return digest;
}

std::vector<unsigned char> ReadExecutable() {
  std::wstring path(32768, L'\0');
  const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
  if (length == 0 || length == path.size()) throw std::runtime_error("Executable path is unavailable");
  path.resize(length);
  std::ifstream stream(path, std::ios::binary | std::ios::ate);
  if (!stream) throw std::runtime_error("Executable could not be opened");
  const auto size = stream.tellg();
  if (size < static_cast<std::streamoff>(kFooterSize)) throw std::runtime_error("Release payload footer is missing");
  std::vector<unsigned char> bytes(static_cast<std::size_t>(size));
  stream.seekg(0);
  stream.read(reinterpret_cast<char*>(bytes.data()), size);
  if (!stream) throw std::runtime_error("Executable could not be read");
  return bytes;
}

std::array<unsigned char, 32> ParseHexHash(const std::wstring& value) {
  if (value.size() != 64) throw std::runtime_error("File hash length is invalid");
  std::array<unsigned char, 32> output{};
  for (std::size_t i = 0; i < output.size(); ++i) {
    const auto hex = value.substr(i * 2, 2);
    wchar_t* end = nullptr;
    const auto parsed = wcstoul(hex.c_str(), &end, 16);
    if (!end || *end != L'\0') throw std::runtime_error("File hash is invalid");
    output[i] = static_cast<unsigned char>(parsed);
  }
  return output;
}

bool SafeIdentifier(const std::wstring& value) {
  if (value.empty() || value.size() > 64) return false;
  for (const wchar_t character : value) {
    if (!((character >= L'a' && character <= L'z') || (character >= L'A' && character <= L'Z')
      || (character >= L'0' && character <= L'9') || character == L'-')) return false;
  }
  return true;
}

std::filesystem::path SafeRelativePath(const std::wstring& value) {
  if (value.empty() || value.front() == L'/' || value.find(L'\\') != std::wstring::npos || value.find(L'\0') != std::wstring::npos) {
    throw std::runtime_error("Release file path is unsafe");
  }
  std::filesystem::path path;
  std::size_t start = 0;
  while (start <= value.size()) {
    const auto end = value.find(L'/', start);
    const auto part = value.substr(start, end == std::wstring::npos ? value.size() - start : end - start);
    std::wstring stem = part.substr(0, part.find(L'.'));
    std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t character) { return static_cast<wchar_t>(std::towupper(character)); });
    const bool reserved = stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL"
      || (stem.size() == 4 && (stem.starts_with(L"COM") || stem.starts_with(L"LPT")) && stem[3] >= L'1' && stem[3] <= L'9');
    const bool invalidCharacter = std::any_of(part.begin(), part.end(), [](wchar_t character) {
      return character < 32 || std::wstring_view(L"<>:\"|?*").find(character) != std::wstring_view::npos;
    });
    if (part.empty() || part == L"." || part == L".." || invalidCharacter || reserved
        || part.back() == L'.' || part.back() == L' ') throw std::runtime_error("Release file path is unsafe");
    path /= part;
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return path;
}

std::uint64_t SafeJsonLength(double value) {
  constexpr double kMaxSafeInteger = 9007199254740991.0;
  if (!std::isfinite(value) || value < 0 || value > kMaxSafeInteger || std::floor(value) != value) {
    throw std::runtime_error("Release file length is invalid");
  }
  return static_cast<std::uint64_t>(value);
}

ReleasePayload ParsePayload() {
  ReleasePayload result;
  result.executable = ReadExecutable();
  PayloadFooter footer{};
  memcpy(&footer, result.executable.data() + result.executable.size() - kFooterSize, kFooterSize);
  if (!std::equal(kFooterMagic.begin(), kFooterMagic.end(), footer.magic)
      || footer.version != kPayloadVersion || footer.footerSize != kFooterSize) throw std::runtime_error("Release payload footer is invalid");
  if (footer.manifestLength > result.executable.size() || footer.filesLength > result.executable.size()
      || footer.manifestLength > std::numeric_limits<std::uint64_t>::max() - footer.filesLength) throw std::runtime_error("Release payload bounds are invalid");
  const auto payloadLength = footer.manifestLength + footer.filesLength;
  if (payloadLength > result.executable.size() - kFooterSize) throw std::runtime_error("Release payload bounds are invalid");
  const auto payloadOffset = result.executable.size() - kFooterSize - static_cast<std::size_t>(payloadLength);
  const auto payloadSpan = std::span(result.executable).subspan(payloadOffset, static_cast<std::size_t>(payloadLength));
  if (Sha256(payloadSpan) != std::to_array(footer.payloadHash)) throw std::runtime_error("Release payload hash does not match");
  const auto manifestBytes = payloadSpan.first(static_cast<std::size_t>(footer.manifestLength));
  const JsonObject manifest = JsonObject::Parse(Utf8ToWide(manifestBytes));
  if (manifest.GetNamedNumber(L"schemaVersion") != 1 || manifest.GetNamedString(L"target") != L"windows-x64") {
    throw std::runtime_error("Release payload schema is unsupported");
  }
  result.projectId = manifest.GetNamedString(L"projectId");
  result.buildId = manifest.GetNamedString(L"buildId");
  result.title = manifest.GetNamedString(L"title");
  result.entry = manifest.GetNamedString(L"entry");
  if (!SafeIdentifier(result.projectId) || !SafeIdentifier(result.buildId)) throw std::runtime_error("Release identity is invalid");
  const auto entryPath = SafeRelativePath(result.entry);
  const auto fileArray = manifest.GetNamedArray(L"files");
  std::map<std::filesystem::path, bool> paths;
  std::uint64_t expectedOffset = 0;
  bool hasEntry = false;
  for (const auto& value : fileArray) {
    const auto file = value.GetObject();
    const std::wstring filePath = file.GetNamedString(L"path").c_str();
    const std::wstring fileHash = file.GetNamedString(L"sha256").c_str();
    FileEntry item{
      SafeRelativePath(filePath),
      SafeJsonLength(file.GetNamedNumber(L"offset")),
      SafeJsonLength(file.GetNamedNumber(L"length")),
      ParseHexHash(fileHash)
    };
    if (item.offset != expectedOffset || item.offset > footer.filesLength
        || item.length > footer.filesLength - item.offset || paths.contains(item.relativePath)) {
      throw std::runtime_error("Release file table is invalid");
    }
    expectedOffset += item.length;
    paths[item.relativePath] = true;
    hasEntry = hasEntry || item.relativePath == entryPath;
    result.files.push_back(item);
  }
  if (expectedOffset != footer.filesLength || !hasEntry) throw std::runtime_error("Release file table is incomplete");
  result.fileRegionOffset = payloadOffset + footer.manifestLength;
  return result;
}

std::filesystem::path ExtractPayload(const ReleasePayload& payload) {
  const auto parent = std::filesystem::temp_directory_path() / L"ReignsAgentPlayer";
  std::filesystem::create_directories(parent);
  GUID identifier{};
  wchar_t name[40]{};
  if (FAILED(CoCreateGuid(&identifier)) || StringFromGUID2(identifier, name, static_cast<int>(std::size(name))) == 0) {
    throw std::runtime_error("Release extraction identity failed");
  }
  const auto root = parent / name;
  if (!CreateDirectoryW(root.c_str(), nullptr)) throw std::runtime_error("Release extraction directory failed");
  for (const auto& file : payload.files) {
    const auto target = (root / file.relativePath).lexically_normal();
    const auto relative = target.lexically_relative(root);
    if (relative.empty() || *relative.begin() == L"..") throw std::runtime_error("Release extraction path escapes its root");
    const auto begin = payload.fileRegionOffset + file.offset;
    const auto bytes = std::span(payload.executable).subspan(static_cast<std::size_t>(begin), static_cast<std::size_t>(file.length));
    if (Sha256(bytes) != file.hash) throw std::runtime_error("Release file hash does not match");
    std::filesystem::create_directories(target.parent_path());
    std::ofstream stream(target, std::ios::binary | std::ios::trunc);
    stream.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!stream) throw std::runtime_error("Release file extraction failed");
  }
  return root;
}

std::filesystem::path UserDataFolder(const std::wstring& projectId) {
  PWSTR value = nullptr;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &value))) throw std::runtime_error("Local application data is unavailable");
  std::filesystem::path path = std::filesystem::path(value) / L"ReignsAgentPlayer" / projectId / L"WebView2";
  CoTaskMemFree(value);
  std::filesystem::create_directories(path);
  return path;
}

void WriteSmokeOutput(const std::wstring& value) {
  const std::string utf8 = winrt::to_string(value + L"\n");
  const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD written = 0;
  if (output && output != INVALID_HANDLE_VALUE) WriteFile(output, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_DPICHANGED) {
    const auto* suggested = reinterpret_cast<RECT*>(lParam);
    SetWindowPos(window, nullptr, suggested->left, suggested->top,
      suggested->right - suggested->left, suggested->bottom - suggested->top,
      SWP_NOACTIVATE | SWP_NOZORDER);
    return 0;
  }
  if (message == WM_SIZE && g_controller) {
    g_controller->put_IsVisible(wParam != SIZE_MINIMIZED);
    RECT bounds{};
    GetClientRect(window, &bounds);
    g_controller->put_Bounds(bounds);
    return 0;
  }
  if (message == WM_DESTROY) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

RECT InitialWindowBounds() {
  const UINT dpi = GetDpiForSystem();
  RECT workArea{};
  if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &workArea, 0)) {
    workArea = { 0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN) };
  }
  RECT frame{ 0, 0, MulDiv(1100, dpi, 96), MulDiv(760, dpi, 96) };
  AdjustWindowRectExForDpi(&frame, WS_OVERLAPPEDWINDOW, FALSE, 0, dpi);
  const int margin = MulDiv(24, dpi, 96);
  const int availableWidth = static_cast<int>(std::max(1L, workArea.right - workArea.left - margin * 2L));
  const int availableHeight = static_cast<int>(std::max(1L, workArea.bottom - workArea.top - margin * 2L));
  const int frameWidth = static_cast<int>(frame.right - frame.left);
  const int frameHeight = static_cast<int>(frame.bottom - frame.top);
  const int width = std::min(frameWidth, availableWidth);
  const int height = std::min(frameHeight, availableHeight);
  const int left = workArea.left + (workArea.right - workArea.left - width) / 2;
  const int top = workArea.top + (workArea.bottom - workArea.top - height) / 2;
  return { left, top, left + width, top + height };
}

void StartWebView(HWND window, const ReleasePayload& payload) {
  LPWSTR runtimeVersion = nullptr;
  if (FAILED(GetAvailableCoreWebView2BrowserVersionString(nullptr, &runtimeVersion)) || !runtimeVersion) {
    throw std::runtime_error("Microsoft Edge WebView2 Runtime is required. Download it from https://developer.microsoft.com/microsoft-edge/webview2/");
  }
  CoTaskMemFree(runtimeVersion);
  const auto userData = UserDataFolder(payload.projectId).wstring();
  const auto extractRoot = g_extractRoot.wstring();
  const auto title = payload.title;
  const HRESULT started = CreateCoreWebView2EnvironmentWithOptions(nullptr, userData.c_str(), nullptr,
    Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
      [window, extractRoot, title](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
        if (FAILED(result) || !environment) { MessageBoxW(window, L"WebView2 environment creation failed.", title.c_str(), MB_ICONERROR); PostQuitMessage(2); return result; }
        return environment->CreateCoreWebView2Controller(window,
          Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [window, extractRoot, title](HRESULT controllerResult, ICoreWebView2Controller* controller) -> HRESULT {
              if (FAILED(controllerResult) || !controller) { MessageBoxW(window, L"WebView2 controller creation failed.", title.c_str(), MB_ICONERROR); PostQuitMessage(2); return controllerResult; }
              g_controller = controller;
              controller->get_CoreWebView2(&g_webview);
              RECT bounds{}; GetClientRect(window, &bounds); controller->put_Bounds(bounds);
              controller->put_IsVisible(TRUE);
              ComPtr<ICoreWebView2Settings> settings; g_webview->get_Settings(&settings);
              settings->put_AreDefaultContextMenusEnabled(FALSE);
              settings->put_AreDevToolsEnabled(FALSE);
              settings->put_IsStatusBarEnabled(FALSE);
              ComPtr<ICoreWebView2_3> webview3;
              if (FAILED(g_webview.As(&webview3))) { PostQuitMessage(2); return E_NOINTERFACE; }
              webview3->SetVirtualHostNameToFolderMapping(L"reignsagent.local", extractRoot.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
              EventRegistrationToken token{};
              g_webview->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
                [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                  LPWSTR uri = nullptr; args->get_Uri(&uri);
                  const bool allowed = uri && std::wstring(uri).starts_with(kVirtualOrigin);
                  CoTaskMemFree(uri);
                  if (!allowed) args->put_Cancel(TRUE);
                  return S_OK;
                }).Get(), &token);
              g_webview->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                  LPWSTR uri = nullptr;
                  args->get_Uri(&uri);
                  if (IsExternalHttpUrl(uri)) ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
                  CoTaskMemFree(uri);
                  args->put_Handled(TRUE);
                  return S_OK;
                }).Get(), &token);
              g_webview->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>(
                [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT { args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY); return S_OK; }).Get(), &token);
              ComPtr<ICoreWebView2_4> webview4;
              if (SUCCEEDED(g_webview.As(&webview4))) {
                webview4->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>(
                  [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT { args->put_Cancel(TRUE); return S_OK; }).Get(), &token);
              }
              g_webview->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
                [](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                  if (!g_smoke) return S_OK;
                  BOOL succeeded = FALSE;
                  BOOL visible = FALSE;
                  args->get_IsSuccess(&succeeded);
                  if (g_controller) g_controller->get_IsVisible(&visible);
                  if (succeeded && visible) WriteSmokeOutput(g_smokeSummary);
                  PostQuitMessage(succeeded && visible ? 0 : 3);
                  return S_OK;
                }).Get(), &token);
              if (!g_smoke) ShowWindow(window, SW_SHOW);
              g_webview->Navigate(L"https://reignsagent.local/player.html?build=game.game.json&embedded=1");
              return S_OK;
            }).Get());
      }).Get());
  if (FAILED(started)) throw std::runtime_error("WebView2 startup failed");
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR commandLine, int) {
  try {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    g_smoke = commandLine && std::wstring(commandLine).find(L"--smoke-test") != std::wstring::npos;
    const ReleasePayload payload = ParsePayload();
    g_extractRoot = ExtractPayload(payload);
    const auto gamePath = g_extractRoot / L"game.game.json";
    std::ifstream game(gamePath, std::ios::binary);
    const std::vector<unsigned char> gameBytes((std::istreambuf_iterator<char>(game)), std::istreambuf_iterator<char>());
    const std::wstring gameText = Utf8ToWide(gameBytes);
    std::size_t cardCount = 0;
    try { cardCount = JsonObject::Parse(gameText).GetNamedObject(L"content").GetNamedArray(L"cards").Size(); } catch (...) {}
    g_smokeSummary = L"ReignsAgent player smoke passed: title=" + payload.title + L" cards=" + std::to_wstring(cardCount);

    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = kWindowClass;
    windowClass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(101));
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    if (!RegisterClassW(&windowClass)) throw std::runtime_error("Player window class registration failed");
    const RECT initialBounds = InitialWindowBounds();
    HWND window = CreateWindowExW(0, kWindowClass, payload.title.c_str(), WS_OVERLAPPEDWINDOW,
      initialBounds.left, initialBounds.top, initialBounds.right - initialBounds.left, initialBounds.bottom - initialBounds.top,
      nullptr, nullptr, instance, nullptr);
    if (!window) throw std::runtime_error("Player window creation failed");
    StartWebView(window, payload);
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    g_webview.Reset();
    g_controller.Reset();
    std::error_code ignored;
    std::filesystem::remove_all(g_extractRoot, ignored);
    return static_cast<int>(message.wParam);
  } catch (const winrt::hresult_error& error) {
    MessageBoxW(nullptr, error.message().c_str(), L"ReignsAgent Player", MB_ICONERROR | MB_OK);
  } catch (const std::exception& error) {
    const std::wstring message = Utf8ToWide(std::span(reinterpret_cast<const unsigned char*>(error.what()), strlen(error.what())));
    MessageBoxW(nullptr, message.c_str(), L"ReignsAgent Player", MB_ICONERROR | MB_OK);
  }
  return 1;
}
