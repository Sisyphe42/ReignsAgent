import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCreatorBackend } from "./backend.js";
import "./styles.css";

const creatorBackendPromise = createCreatorBackend();
if (import.meta.env.VITE_CREATOR_HOST === "browser") void registerHostedServiceWorker();

const PANELS = [
  { id: "overview", label: "Overview", group: "Project" },
  { id: "content", label: "Content", group: "Authoring" },
  { id: "story", label: "Story", group: "Authoring" },
  { id: "review", label: "Review", group: "Quality" },
  { id: "ai-edit", label: "AI Assist", group: "Quality" },
  { id: "preview", label: "Preview", group: "Quality" },
  { id: "build", label: "Build", group: "Release" },
  { id: "settings", label: "Settings", group: "Release" }
];

const FACTIONS = ["gauge0", "gauge1", "gauge2", "gauge3"];
const SKINS = [
  ["github-light", "Github Light"],
  ["catppuccin-latte", "Catppuccin Latte"],
  ["classic", "Classic"],
  ["famicom", "Famicom"],
  ["phantom", "Phantom"],
  ["arcade", "Arcade"],
  ["terminal", "Terminal"]
];

const DEFAULT_PANEL = "overview";
const DEFAULT_SKIN = "github-light";
const LEGACY_DRAFT_KEY = "reigns-agent.creator-web.editor-draft";
const RAIL_COLLAPSED_KEY = "reigns-agent.creator-web.rail-collapsed";
const UI_LOCALES = [
  ["system", "Follow browser / device"],
  ["en", "English"],
  ["zh-Hans", "简体中文"]
];
const LocaleContext = createContext("en");
const ZH_HANS_COPY = {
  Overview: "概览", Project: "项目", Content: "内容", Authoring: "创作", Story: "叙事",
  Review: "审查", Quality: "质量", "AI Assist": "AI 辅助", Preview: "预览", Build: "构建",
  Release: "发布", Settings: "设置", Player: "玩家端", Skin: "皮肤", New: "新建", Sample: "示例",
  Delete: "删除", cards: "张卡牌", "player ready": "玩家端就绪", "player blocked": "玩家端受阻",
  "Browser workspace": "浏览器工作区", "Local session": "本地会话", "Desktop session": "桌面会话",
  "Collapse navigation": "收起导航", "Expand navigation": "展开导航", "Open player preview": "打开玩家端预览",
  "Manage project": "管理项目", "New blank project": "新建空白项目", "New from sample": "从示例新建", "Delete project": "删除项目",
  "Follow browser / device": "跟随浏览器 / 设备",
  "Project Overview": "项目概览", "Workspace health, content readiness, and next actions.": "工作区健康度、内容就绪情况与后续操作。",
  "Content / Cards": "内容 / 卡牌", "Card text, left/right choices, faction effects, tags, variables, and art bindings.": "编辑卡牌文本、左右选择、阵营影响、标签、变量与美术绑定。",
  "Story / Graph": "叙事 / 图谱", "Card-to-card transitions driven by tags. Click a node to edit it; rename tags for clarity.": "查看由标签驱动的卡牌流转；点击节点编辑，并可重命名标签。",
  "Review Diagnostics": "审查诊断", "Creator-facing Monte Carlo review with reproducible seed inputs.": "面向创作者、支持可复现种子的蒙特卡洛审查。",
  "Developer Preview": "开发预览", "Debuggable preview over the same headless runtime used by player builds.": "使用与玩家构建相同的无头运行时进行可调试预览。",
  "Build / Deploy": "构建 / 部署", "Prepare and export the deployable player bundle.": "准备并导出可部署的玩家端包。",
  "Contextual draft planning, review repair, and visual request previews.": "基于上下文规划草稿、修复审查问题并预览视觉请求。",
  "Settings / Pipeline": "设置 / 流水线", "Project metadata, AI endpoint posture, locale hooks, and connector planning.": "管理项目元数据、界面语言、AI 端点与连接器规划。",
  Interface: "界面", Language: "语言", "Interface language is shared by browser, local, and desktop clients.": "界面语言设置在浏览器、本地与桌面客户端间共用。",
  "AI Endpoint": "AI 端点", "Connector Request Preview": "连接器请求预览", "Save title": "保存标题",
  "Deck title": "卡组标题", "Channel Type": "渠道类型", "Base URL": "基础 URL", "API Key": "API 密钥",
  Model: "模型", Capabilities: "能力", Advanced: "高级", "Protocol, route, compatibility, and JSON mode": "协议、路由、兼容性与 JSON 模式",
  Protocol: "协议", "Route mode": "路由模式", Compatibility: "兼容性", "JSON mode": "JSON 模式",
  "Fetch /models": "获取 /models", "Validate endpoint": "验证端点", "Build plan": "生成计划",
  "No connector plan generated.": "尚未生成连接器计划。", "Configured endpoints are used when drafting AI Assist plans.": "配置的端点将用于生成 AI 辅助草稿。",
  Setup: "设置", Off: "关闭",
  "Project title saved": "项目标题已保存", ready: "就绪", loading: "加载中", new: "新增", draft: "草稿",
  blocked: "受阻", set: "已设置", Valid: "有效", "Needs work": "需要处理", Ready: "就绪", Blocked: "受阻",
  Cards: "卡牌", Validation: "验证", "Player-ready": "玩家端就绪", "Not run": "未运行", Prepared: "已准备", "Not prepared": "未准备"
};
const SKIN_ALIASES = {
  workbench: "classic"
};
const AI_PROTOCOLS = [
  ["openai_chat", "OpenAI Chat"],
  ["openai_responses", "OpenAI Responses"],
  ["openai_completions", "OpenAI Completions"],
  ["anthropic_messages", "Anthropic Messages"]
];
const AI_PROTOCOL_ALIASES = {
  messages: "openai_chat",
  responses: "openai_responses",
  completions: "openai_completions"
};
const AI_ROUTE_MODES = [
  ["auto", "Auto detect"],
  ["api_root", "API root"],
  ["full_url", "Full URL"]
];
const AI_COMPATIBILITY_FAMILIES = [
  ["openai", "OpenAI-compatible"],
  ["anthropic", "Anthropic direct"],
  ["newapi", "NewAPI / Unified BaseURI"],
  ["local", "Local gateway"],
  ["custom", "Custom"]
];
const AI_JSON_MODES = [
  ["auto", "Auto"],
  ["force", "Force JSON mode"],
  ["off", "Disable JSON mode"]
];
const AI_CAPABILITIES = [
  ["vision", "Vision"],
  ["structuredJson", "Structured JSON"],
  ["tools", "Tools"],
  ["reasoning", "Reasoning"],
  ["streaming", "Streaming"]
];
const DEFAULT_AI_CAPABILITIES = {
  vision: false,
  structuredJson: true,
  tools: false,
  reasoning: false,
  streaming: false
};
const AI_LOGO_SOURCES = {
  openai: ["https://cdn.simpleicons.org/openai/ffffff", "https://openai.com/favicon.ico"],
  anthropic: ["https://cdn.simpleicons.org/anthropic/ffffff", "https://www.anthropic.com/favicon.ico"],
  google: ["https://cdn.simpleicons.org/googlegemini/8E75B2", "https://www.google.com/favicon.ico"],
  deepseek: ["https://cdn.simpleicons.org/deepseek/4D6BFE", "https://www.deepseek.com/favicon.ico"],
  qwen: ["https://cdn.simpleicons.org/alibabacloud/FF6A00", "https://dashscope.aliyuncs.com/favicon.ico"],
  zhipu: ["https://open.bigmodel.cn/favicon.ico", "https://logo.clearbit.com/bigmodel.cn"],
  moonshot: ["https://www.moonshot.cn/favicon.ico", "https://logo.clearbit.com/moonshot.cn"],
  openrouter: ["https://cdn.simpleicons.org/openrouter/ffffff", "https://openrouter.ai/favicon.ico"],
  ollama: ["https://cdn.simpleicons.org/ollama/ffffff", "https://ollama.com/public/ollama.png"],
  sensenova: ["https://platform.sensenova.cn/favicon.ico", "https://www.sensenova.cn/favicon.ico"],
  siliconflow: ["https://siliconflow.cn/favicon.ico", "https://logo.clearbit.com/siliconflow.cn"],
  volcengine: ["https://www.volcengine.com/favicon.ico", "https://logo.clearbit.com/volcengine.com"],
  baidu: ["https://cdn.simpleicons.org/baidu/2932E1", "https://cloud.baidu.com/favicon.ico"],
  tencent: ["https://cdn.simpleicons.org/tencentqq/1EBAFC", "https://cloud.tencent.com/favicon.ico"],
  mistral: ["https://cdn.simpleicons.org/mistralai/FA520F", "https://mistral.ai/favicon.ico"],
  perplexity: ["https://cdn.simpleicons.org/perplexity/1FB8CD", "https://www.perplexity.ai/favicon.ico"],
  xai: ["https://cdn.simpleicons.org/x/ffffff", "https://x.ai/favicon.ico"],
  cohere: ["https://cdn.simpleicons.org/cohere/39594D", "https://cohere.com/favicon.ico"],
  minimax: ["https://www.minimax.io/favicon.ico", "https://logo.clearbit.com/minimax.io"],
  lingyi: ["https://www.01.ai/favicon.ico", "https://logo.clearbit.com/01.ai"],
  newapi: ["https://newapi.pro/favicon.ico", "https://logo.clearbit.com/newapi.pro"],
  local: ["https://cdn.simpleicons.org/ollama/ffffff", "https://ollama.com/public/ollama.png"],
  custom: []
};
const AI_ENDPOINT_PRESETS = [
  {
    id: "newapi",
    label: "NewAPI / Unified BaseURI",
    channelName: "NewAPI",
    baseUrl: "https://your-newapi.example.com/v1",
    iconKey: "newapi",
    iconLabel: "NA",
    protocol: "openai_chat",
    compatibilityFamily: "newapi",
    models: [
      aiModel("gpt-5", "GPT-5", { vision: true, tools: true, reasoning: true }),
      aiModel("gpt-5-mini", "GPT-5 mini", { vision: true, tools: true, reasoning: true }),
      aiModel("claude-sonnet-4-20250514", "Claude Sonnet 4", { vision: true, structuredJson: false }),
      aiModel("gemini-2.5-pro", "Gemini 2.5 Pro", { vision: true }),
      aiModel("deepseek-chat", "DeepSeek Chat"),
      aiModel("deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
      aiModel("qwen-max", "Qwen Max"),
      aiModel("glm-4-plus", "GLM-4 Plus"),
      aiModel("moonshot-v1-128k", "Moonshot v1 128K")
    ]
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    iconKey: "openai",
    iconLabel: "OA",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("gpt-5", "GPT-5", { vision: true, tools: true, reasoning: true }),
      aiModel("gpt-5-mini", "GPT-5 mini", { vision: true, tools: true, reasoning: true }),
      aiModel("gpt-5-nano", "GPT-5 nano", { tools: true, reasoning: true }),
      aiModel("gpt-4.1", "GPT-4.1", { vision: true, tools: true, reasoning: true }),
      aiModel("gpt-4.1-mini", "GPT-4.1 mini", { vision: true, tools: true }),
      aiModel("gpt-4o", "GPT-4o", { vision: true, tools: true }),
      aiModel("gpt-4o-mini", "GPT-4o mini", { vision: true, tools: true }),
      aiModel("o3", "o3", { reasoning: true, tools: true }),
      aiModel("o4-mini", "o4-mini", { reasoning: true, tools: true })
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    iconKey: "anthropic",
    iconLabel: "AN",
    protocol: "anthropic_messages",
    compatibilityFamily: "anthropic",
    models: [
      aiModel("claude-sonnet-4-20250514", "Claude Sonnet 4", { vision: true, structuredJson: false }, "anthropic_messages"),
      aiModel("claude-opus-4-20250514", "Claude Opus 4", { vision: true, structuredJson: false, reasoning: true }, "anthropic_messages"),
      aiModel("claude-3-7-sonnet-20250219", "Claude 3.7 Sonnet", { vision: true, structuredJson: false, reasoning: true }, "anthropic_messages"),
      aiModel("claude-3-5-haiku-20241022", "Claude 3.5 Haiku", { vision: true, structuredJson: false }, "anthropic_messages")
    ]
  },
  {
    id: "gemini-openai",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    iconKey: "google",
    iconLabel: "GE",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("gemini-2.5-pro", "Gemini 2.5 Pro", { vision: true }),
      aiModel("gemini-2.5-flash", "Gemini 2.5 Flash", { vision: true }),
      aiModel("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", { vision: true }),
      aiModel("gemini-2.0-flash", "Gemini 2.0 Flash", { vision: true })
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    iconKey: "deepseek",
    iconLabel: "DS",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("deepseek-chat", "DeepSeek Chat"),
      aiModel("deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
      aiModel("deepseek-coder", "DeepSeek Coder")
    ]
  },
  {
    id: "qwen",
    label: "Qwen / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    iconKey: "qwen",
    iconLabel: "QW",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("qwen-max", "Qwen Max"),
      aiModel("qwen-plus", "Qwen Plus"),
      aiModel("qwen-turbo", "Qwen Turbo"),
      aiModel("qwen3-max", "Qwen3 Max", { reasoning: true }),
      aiModel("qwen3-plus", "Qwen3 Plus", { reasoning: true }),
      aiModel("qwen-vl-plus", "Qwen VL Plus", { vision: true }),
      aiModel("qwq-plus", "QwQ Plus", { reasoning: true })
    ]
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    iconKey: "moonshot",
    iconLabel: "MS",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("kimi-k2-0711-preview", "Kimi K2"),
      aiModel("moonshot-v1-8k", "Moonshot v1 8K"),
      aiModel("moonshot-v1-32k", "Moonshot v1 32K"),
      aiModel("moonshot-v1-128k", "Moonshot v1 128K")
    ]
  },
  {
    id: "zhipu",
    label: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    iconKey: "zhipu",
    iconLabel: "GL",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("glm-4-plus", "GLM-4 Plus"),
      aiModel("glm-4-flash", "GLM-4 Flash"),
      aiModel("glm-4-air", "GLM-4 Air"),
      aiModel("glm-4.5", "GLM-4.5", { reasoning: true }),
      aiModel("glm-4v-plus", "GLM-4V Plus", { vision: true })
    ]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    iconKey: "openrouter",
    iconLabel: "OR",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("openai/gpt-5", "OpenAI GPT-5", { vision: true, tools: true, reasoning: true }),
      aiModel("anthropic/claude-sonnet-4", "Claude Sonnet 4", { vision: true, structuredJson: false }),
      aiModel("google/gemini-2.5-pro", "Gemini 2.5 Pro", { vision: true }),
      aiModel("deepseek/deepseek-chat", "DeepSeek Chat"),
      aiModel("qwen/qwen3-235b-a22b", "Qwen3 235B", { reasoning: true }),
      aiModel("mistralai/mistral-large", "Mistral Large")
    ]
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    iconKey: "siliconflow",
    iconLabel: "SF",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("deepseek-ai/DeepSeek-V3", "DeepSeek V3"),
      aiModel("deepseek-ai/DeepSeek-R1", "DeepSeek R1", { reasoning: true }),
      aiModel("Qwen/Qwen3-235B-A22B", "Qwen3 235B", { reasoning: true }),
      aiModel("moonshotai/Kimi-K2-Instruct", "Kimi K2"),
      aiModel("THUDM/GLM-4.1V-9B-Thinking", "GLM-4.1V Thinking", { vision: true, reasoning: true })
    ]
  },
  {
    id: "sensenova",
    label: "SenseNova",
    baseUrl: "https://token.sensenova.cn/v1",
    iconKey: "sensenova",
    iconLabel: "SN",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("sensenova-6.7-flash-lite", "SenseNova 6.7 Flash-Lite"),
      aiModel("deepseek-v4-flash", "DeepSeek V4 Flash")
    ]
  },
  {
    id: "local",
    label: "Local gateway",
    baseUrl: "http://127.0.0.1:11434/v1",
    iconKey: "local",
    iconLabel: "LC",
    protocol: "openai_chat",
    compatibilityFamily: "local",
    models: [
      aiModel("llama3.3", "Llama 3.3", { structuredJson: false }),
      aiModel("llama3.1", "Llama 3.1", { structuredJson: false }),
      aiModel("qwen3", "Qwen3", { reasoning: true }),
      aiModel("qwen2.5", "Qwen 2.5"),
      aiModel("deepseek-r1", "DeepSeek R1", { structuredJson: false, reasoning: true }),
      aiModel("mistral", "Mistral", { structuredJson: false }),
      aiModel("gemma3", "Gemma 3", { structuredJson: false })
    ]
  },
  {
    id: "volcengine",
    label: "VolcEngine / Doubao",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    iconKey: "volcengine",
    iconLabel: "DB",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("doubao-seed-1-6", "Doubao Seed 1.6", { reasoning: true }),
      aiModel("doubao-1-5-pro-32k", "Doubao 1.5 Pro 32K"),
      aiModel("doubao-1-5-lite-32k", "Doubao 1.5 Lite 32K"),
      aiModel("doubao-1-5-vision-pro-32k", "Doubao Vision Pro", { vision: true })
    ]
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    iconKey: "mistral",
    iconLabel: "MI",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("mistral-large-latest", "Mistral Large"),
      aiModel("mistral-small-latest", "Mistral Small"),
      aiModel("pixtral-large-latest", "Pixtral Large", { vision: true }),
      aiModel("codestral-latest", "Codestral"),
      aiModel("magistral-medium-latest", "Magistral Medium", { reasoning: true })
    ]
  },
  {
    id: "perplexity",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    iconKey: "perplexity",
    iconLabel: "PX",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("sonar", "Sonar"),
      aiModel("sonar-pro", "Sonar Pro"),
      aiModel("sonar-reasoning", "Sonar Reasoning", { reasoning: true }),
      aiModel("sonar-deep-research", "Sonar Deep Research", { reasoning: true })
    ]
  },
  {
    id: "xai",
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    iconKey: "xai",
    iconLabel: "XA",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("grok-4", "Grok 4", { reasoning: true }),
      aiModel("grok-3", "Grok 3", { reasoning: true }),
      aiModel("grok-3-mini", "Grok 3 mini", { reasoning: true })
    ]
  },
  {
    id: "baidu",
    label: "Baidu Qianfan",
    baseUrl: "https://qianfan.baidubce.com/v2",
    iconKey: "baidu",
    iconLabel: "BD",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("ernie-4.5-turbo-128k", "ERNIE 4.5 Turbo 128K"),
      aiModel("ernie-4.5-turbo-vl-32k", "ERNIE 4.5 Turbo VL", { vision: true }),
      aiModel("ernie-x1-turbo-32k", "ERNIE X1 Turbo", { reasoning: true }),
      aiModel("ernie-speed-128k", "ERNIE Speed 128K")
    ]
  },
  {
    id: "tencent",
    label: "Tencent Hunyuan",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    iconKey: "tencent",
    iconLabel: "HY",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("hunyuan-turbos-latest", "Hunyuan TurboS"),
      aiModel("hunyuan-t1-latest", "Hunyuan T1", { reasoning: true }),
      aiModel("hunyuan-vision", "Hunyuan Vision", { vision: true })
    ]
  },
  {
    id: "cohere",
    label: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    iconKey: "cohere",
    iconLabel: "CO",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("command-a-03-2025", "Command A"),
      aiModel("command-r-plus", "Command R+"),
      aiModel("command-r", "Command R")
    ]
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    iconKey: "minimax",
    iconLabel: "MM",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("MiniMax-M1", "MiniMax M1", { reasoning: true }),
      aiModel("MiniMax-Text-01", "MiniMax Text 01"),
      aiModel("abab6.5s-chat", "abab6.5s Chat")
    ]
  },
  {
    id: "lingyi",
    label: "01.AI",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    iconKey: "lingyi",
    iconLabel: "01",
    protocol: "openai_chat",
    compatibilityFamily: "openai",
    models: [
      aiModel("yi-large", "Yi Large"),
      aiModel("yi-medium", "Yi Medium"),
      aiModel("yi-lightning", "Yi Lightning"),
      aiModel("yi-vision", "Yi Vision", { vision: true })
    ]
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    iconKey: "custom",
    iconLabel: "..",
    protocol: "openai_chat",
    compatibilityFamily: "custom",
    models: [
      aiModel("gpt-5", "GPT-5", { vision: true, tools: true, reasoning: true }),
      aiModel("gpt-4.1-mini", "GPT-4.1 mini", { vision: true, tools: true }),
      aiModel("claude-sonnet-4-20250514", "Claude Sonnet 4", { vision: true, structuredJson: false }),
      aiModel("gemini-2.5-pro", "Gemini 2.5 Pro", { vision: true }),
      aiModel("deepseek-chat", "DeepSeek Chat"),
      aiModel("deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
      aiModel("qwen-plus", "Qwen Plus"),
      aiModel("glm-4-plus", "GLM-4 Plus"),
      aiModel("moonshot-v1-128k", "Moonshot 128K"),
      aiModel("mistral-large-latest", "Mistral Large")
    ]
  }
];

function aiModel(id, label = id, capabilities = {}, protocol = "openai_chat") {
  return {
    id,
    label,
    protocol,
    capabilities: normalizeCapabilityState(capabilities)
  };
}
const AI_PROGRESS_STEPS = ["Context", "Request", "Local draft", "Parse", "Validate", "Ready"];
const AI_MODE_LABELS = {
  generate_cards: "Draft cards",
  repair_diagnostics: "Repair review",
  generate_asset: "Generate visual request",
  analyze_asset: "Analyze visual request"
};
const AI_AMBIENT_ACTIONS = [
  ["rewrite", "Rewrite", "Rewrite selected content"],
  ["translate", "Translate", "Translate to current locale"],
  ["explain", "Explain", "Explain author impact"],
  ["branch", "Branch", "Draft a branch from this context"]
];

function isKnownPanel(value) {
  return PANELS.some((panel) => panel.id === value);
}

function normalizeUiLocale(value) {
  if (value === "zh-Hans" || String(value ?? "").toLowerCase().startsWith("zh")) return "zh-Hans";
  return "en";
}

function normalizeUiLocalePreference(value) {
  if (value === "system") return "system";
  return normalizeUiLocale(value);
}

function readDeviceUiLocale() {
  if (typeof navigator === "undefined") return "en";
  return normalizeUiLocale(navigator.languages?.[0] ?? navigator.language);
}

function tr(locale, source) {
  return normalizeUiLocale(locale) === "zh-Hans" ? (ZH_HANS_COPY[source] ?? source) : source;
}

function useUiLocale() {
  return useContext(LocaleContext);
}

function PanelIcon({ id }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
      {id === "overview" && <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />}
      {id === "content" && <><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M15 3.5v3h3M9 11h6M9 15h6" /></>}
      {id === "story" && <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="8" r="2" /><circle cx="10" cy="18" r="2" /><path d="M8 6.3l8 1.3M7 8l2 8M16.5 9.5l-5 6.8" /></>}
      {id === "review" && <><path d="M5 4h14v16H5z" /><path d="M8 9l1.5 1.5L12 8M8 15h8" /></>}
      {id === "ai-edit" && <><path d="M12 3l1.2 4.1L17 8.5l-3.8 1.4L12 14l-1.2-4.1L7 8.5l3.8-1.4z" /><path d="M18.5 14l.7 2.3 2.3.7-2.3.8-.7 2.2-.8-2.2-2.2-.8 2.2-.7z" /></>}
      {id === "preview" && <><path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5z" /><circle cx="12" cy="12" r="2.3" /></>}
      {id === "build" && <><path d="M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" /></>}
      {id === "settings" && <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>}
    </svg>
  );
}

function readRailCollapsed() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(RAIL_COLLAPSED_KEY) === "true";
}

function isKnownSkin(value) {
  return SKINS.some(([id]) => id === value);
}

function resolveSkinId(value) {
  const skin = SKIN_ALIASES[value] ?? value;
  return isKnownSkin(skin) ? skin : null;
}

function readUrlState() {
  if (typeof window === "undefined") {
    return { panel: DEFAULT_PANEL, hasExplicitPanel: false, skin: null, aiAssist: null, client: "web" };
  }

  const url = new URL(window.location.href);
  const appPath = stripBasePath(url.pathname);
  const directPanel = appPath.startsWith("/workbench/")
    ? appPath.slice("/workbench/".length).split("/")[0]
    : null;
  const queryPanel = url.searchParams.get("panel");
  const explicitPanel = [directPanel, queryPanel].find(isKnownPanel) ?? null;
  const panel = explicitPanel ?? DEFAULT_PANEL;
  const skin = url.searchParams.get("skin");
  const ai = url.searchParams.get("ai");
  const aiAssist = ai === null ? null : ["1", "true", "on"].includes(ai.toLowerCase());

  return {
    panel,
    hasExplicitPanel: explicitPanel !== null,
    skin: resolveSkinId(skin),
    aiAssist,
    client: url.searchParams.get("client") === "desktop" ? "desktop" : "web"
  };
}

function buildWorkbenchUrl(panel, skin) {
  const url = new URL(window.location.href);
  url.pathname = withBasePath(panel === DEFAULT_PANEL ? "/workbench" : `/workbench/${panel}`);
  url.searchParams.set("skin", resolveSkinId(skin) ?? DEFAULT_SKIN);
  url.searchParams.delete("panel");
  return `${url.pathname}${url.search}${url.hash}`;
}

function syncWorkbenchUrl(panel, skin, mode = "replace") {
  if (typeof window === "undefined") return;
  const nextUrl = buildWorkbenchUrl(panel, skin);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextUrl);
}

function syncAiAssistUrl(enabled, mode = "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set("ai", "1");
  else url.searchParams.delete("ai");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextUrl);
  }
}

async function api(path, options = {}) {
  return (await creatorBackendPromise).request(path, options);
}

function stripBasePath(pathname) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return base && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
}

function withBasePath(pathname) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${pathname}` || "/";
}

async function registerHostedServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = `${import.meta.env.BASE_URL}manifest.webmanifest`;
  document.head.append(manifest);
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  const offerUpdate = (worker) => worker?.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller && window.confirm("A new ReignsAgent version is ready. Reload now?")) worker.postMessage({ type: "SKIP_WAITING" });
  });
  offerUpdate(registration.installing);
  registration.addEventListener("updatefound", () => offerUpdate(registration.installing));
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}

function formatAiEndpointError(error) {
  const message = error?.message ?? String(error);
  if (message.includes("Unknown API route")) {
    return `${message}. Restart the local dashboard API server so it loads the latest backend routes.`;
  }
  return message;
}

function defaultAiSettings() {
  return {
    baseUrl: "",
    protocol: "openai_chat",
    endpointPresetId: "custom",
    endpointIconKey: "custom",
    modelPresetId: null,
    compatibilityFamily: "custom",
    routeMode: "auto",
    jsonMode: "auto",
    modelId: "",
    capabilities: { ...DEFAULT_AI_CAPABILITIES }
  };
}

function normalizeAiProtocol(value) {
  const canonical = AI_PROTOCOL_ALIASES[value] ?? value;
  return AI_PROTOCOLS.some(([id]) => id === canonical) ? canonical : "openai_chat";
}

function findEndpointPresetByBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!normalized) return null;
  return AI_ENDPOINT_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl.replace(/\/+$/, "") === normalized) ?? null;
}

function getEndpointPreset(id) {
  return AI_ENDPOINT_PRESETS.find((preset) => preset.id === id) ?? AI_ENDPOINT_PRESETS.find((preset) => preset.id === "custom");
}

function getModelPresetsForEndpoint(settings) {
  const preset = getEndpointPreset(settings.endpointPresetId);
  return preset?.models ?? [];
}

function findModelPresetByModelId(settings, modelId) {
  const normalized = String(modelId ?? "").trim();
  if (!normalized) return null;
  return getModelPresetsForEndpoint(settings).find((model) => model.id === normalized) ?? null;
}

function mergeAiModelOptions(...modelGroups) {
  const seen = new Set();
  return modelGroups.flatMap((models) => (Array.isArray(models) ? models : []).flatMap((model) => {
    const id = String(model?.id ?? "").trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: String(model?.label ?? id),
      capabilities: normalizeCapabilityState(model?.capabilities)
    }];
  }));
}

function normalizeCapabilityState(capabilities = {}) {
  return { ...DEFAULT_AI_CAPABILITIES, ...capabilities };
}

function normalizeAiSettings(settings = {}) {
  const defaults = defaultAiSettings();
  const baseUrl = typeof settings.baseUrl === "string" ? settings.baseUrl : "";
  const matchedEndpoint = findEndpointPresetByBaseUrl(baseUrl);
  const requestedPreset = getEndpointPreset(settings.endpointPresetId);
  const endpointPreset = matchedEndpoint ?? (baseUrl.trim() ? getEndpointPreset("custom") : requestedPreset);
  const protocol = normalizeAiProtocol(settings.protocol ?? endpointPreset?.protocol ?? defaults.protocol);
  const routeMode = AI_ROUTE_MODES.some(([id]) => id === settings.routeMode) ? settings.routeMode : defaults.routeMode;
  const jsonMode = AI_JSON_MODES.some(([id]) => id === settings.jsonMode) ? settings.jsonMode : defaults.jsonMode;
  const compatibilityFamily = AI_COMPATIBILITY_FAMILIES.some(([id]) => id === settings.compatibilityFamily)
    ? settings.compatibilityFamily
    : endpointPreset?.compatibilityFamily ?? defaults.compatibilityFamily;
  const capabilities = normalizeCapabilityState(settings.capabilities ?? defaults.capabilities);
  const modelId = typeof settings.modelId === "string" ? settings.modelId : "";
  const matchedModel = (endpointPreset?.models ?? []).find((model) => model.id === modelId);
  return {
    baseUrl,
    protocol,
    endpointPresetId: endpointPreset?.id ?? "custom",
    endpointIconKey: endpointPreset?.iconKey ?? "custom",
    modelPresetId: matchedModel?.id ?? null,
    compatibilityFamily,
    routeMode,
    jsonMode,
    modelId,
    capabilities
  };
}

function aiSettingsFromConfig(config = {}) {
  return normalizeAiSettings({
    baseUrl: config.endpoint ?? "",
    protocol: config.protocol,
    endpointPresetId: config.endpointPresetId,
    compatibilityFamily: config.compatibilityFamily,
    modelId: config.modelId ?? "",
    routeMode: config.routeMode,
    jsonMode: config.jsonMode,
    capabilities: Object.fromEntries(AI_CAPABILITIES.map(([id]) => [id, (config.capabilities ?? []).includes(id)]))
  });
}

function isAiEndpointConfigured(settings) {
  return Boolean(settings?.baseUrl?.trim() && settings?.modelId?.trim());
}

function enabledAiCapabilities(settings) {
  return Object.entries(settings?.capabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);
}

function buildAiConnectorConfig(settings, extra = {}, options = {}) {
  const normalized = normalizeAiSettings(settings);
  return {
    provider: normalized.protocol,
    endpoint: normalized.baseUrl.trim() || null,
    apiKeyRef: options.hasApiKey ? "browser-local" : null,
    modelId: normalized.modelId.trim() || null,
    endpointPresetId: normalized.endpointPresetId,
    endpointIconKey: normalized.endpointIconKey,
    modelPresetId: normalized.modelPresetId,
    compatibilityFamily: normalized.compatibilityFamily,
    routeMode: normalized.routeMode,
    jsonMode: normalized.jsonMode,
    capabilities: enabledAiCapabilities(normalized),
    ...extra
  };
}

function AiProviderLogo({ preset }) {
  const sources = AI_LOGO_SOURCES[preset?.iconKey] ?? [];
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [preset?.iconKey]);
  const logoUrl = sources[sourceIndex] ?? "";
  if (!logoUrl) {
    return <span className="provider-logo provider-logo--fallback" aria-hidden="true">{preset?.iconLabel ?? ".."}</span>;
  }
  return (
    <span className="provider-logo" aria-hidden="true">
      <img src={logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setSourceIndex((index) => index + 1)} />
    </span>
  );
}

function AiProviderDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = getEndpointPreset(value);

  return (
    <div className="ai-dropdown" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button className="ai-dropdown__button" type="button" onClick={() => setOpen((next) => !next)} aria-expanded={open}>
        <AiProviderLogo preset={selected} />
        <span>
          <strong>{selected.label}</strong>
          <small>{selected.compatibilityFamily === "anthropic" ? "Anthropic Messages" : selected.baseUrl || "Custom endpoint"}</small>
        </span>
        <span className="ai-dropdown__chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="ai-dropdown__menu ai-dropdown__menu--providers" role="listbox">
          {AI_ENDPOINT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={preset.id === selected.id ? "ai-dropdown__option ai-dropdown__option--active" : "ai-dropdown__option"}
              type="button"
              role="option"
              aria-selected={preset.id === selected.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(preset.id);
                setOpen(false);
              }}
            >
              <AiProviderLogo preset={preset} />
              <span>
                <strong>{preset.label}</strong>
                <small>{preset.baseUrl || "Custom endpoint"}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AiModelDropdown({ models, value, providerLabel, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => model.id === value) ?? null;

  return (
    <div className="ai-dropdown" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button className="ai-dropdown__button" type="button" onClick={() => setOpen((next) => !next)} aria-expanded={open}>
        <span className="model-dot" aria-hidden="true">{selected ? "M" : ".."}</span>
        <span>
          <strong>{selected?.label ?? "Custom model"}</strong>
          <small>{selected?.id ?? `${providerLabel} model id`}</small>
        </span>
        <span className="ai-dropdown__chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="ai-dropdown__menu" role="listbox">
          {models.length === 0 && (
            <div className="ai-dropdown__empty">No model suggestions loaded.</div>
          )}
          {models.map((model) => (
            <button
              key={model.id}
              className={model.id === value ? "ai-dropdown__option ai-dropdown__option--active" : "ai-dropdown__option"}
              type="button"
              role="option"
              aria-selected={model.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(model.id);
                setOpen(false);
              }}
            >
              <span className="model-dot" aria-hidden="true">M</span>
              <span>
                <strong>{model.label}</strong>
                <small>{model.id}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AiOptionGroup({ label, value, options, onChange }) {
  return (
    <div className="ai-option-group">
      <span className="ai-field-label">{label}</span>
      <div className="ai-option-group__list">
        {options.map(([id, optionLabel]) => (
          <button
            key={id}
            type="button"
            className={value === id ? "ai-option-pill ai-option-pill--active" : "ai-option-pill"}
            onClick={() => onChange(id)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function App() {
  const initialUrlState = useMemo(() => readUrlState(), []);
  const [activePanel, setActivePanel] = useState(initialUrlState.panel);
  const [editor, setEditor] = useState(null);
  const [status, setStatus] = useState("Loading project...");
  const [skin, setSkin] = useState(() => initialUrlState.skin ?? DEFAULT_SKIN);
  const [localePreference, setLocalePreference] = useState("system");
  const [deviceLocale, setDeviceLocale] = useState(readDeviceUiLocale);
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const [aiAssistEnabled, setAiAssistEnabled] = useState(() => initialUrlState.aiAssist ?? false);
  const [aiSettings, setAiSettings] = useState(() => defaultAiSettings());
  const [aiApiKey, setAiApiKey] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [configReady, setConfigReady] = useState(false);
  const [aiDraftRequest, setAiDraftRequest] = useState(null);
  const [aiPreflight, setAiPreflight] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [play, setPlay] = useState({ sessionId: null, state: null });
  const [build, setBuild] = useState(null);
  const [busy, setBusy] = useState("");
  const [draftInfo, setDraftInfo] = useState(null);
  const [focusCardId, setFocusCardId] = useState(null);
  const [aiGraphSelection, setAiGraphSelection] = useState(null);
  const historyRef = useRef([]);
  const [historyDepth, setHistoryDepth] = useState(0);

  // Snapshot the editor bundle before a mutation so it can be undone.
  async function pushHistory() {
    try {
      const snapshot = await api("/api/editor/snapshot");
      const bundle = snapshot.bundle;
      if (bundle) {
        historyRef.current.push(bundle);
        if (historyRef.current.length > 50) historyRef.current.shift();
        setHistoryDepth(historyRef.current.length);
      }
    } catch {
      // Non-fatal: undo just won't cover this mutation.
    }
  }

  async function undo() {
    const bundle = historyRef.current.pop();
    setHistoryDepth(historyRef.current.length);
    if (!bundle) {
      setStatus("Nothing to undo");
      return;
    }
    await runAction("Undoing", async () => {
      await api("/api/editor/restore", { method: "POST", body: { bundle } });
      await refreshEditor({ statusMessage: "Undid last edit" });
    });
  }

  const assetsByCard = useMemo(() => createAssetMap(editor?.assets ?? []), [editor]);
  const playerReady = editor?.playerValidation?.valid === true;
  const aiConfigured = isAiEndpointConfigured(aiSettings);
  const activePanelLabel = PANELS.find((panel) => panel.id === activePanel)?.label ?? "Workspace";
  const desktopClient = initialUrlState.client === "desktop";
  const aiPresenceState = aiAssistEnabled ? (aiConfigured ? "ready" : "setup") : "off";
  const aiPresenceLabel = aiPresenceState === "ready" ? "Ready" : aiPresenceState === "setup" ? "Setup" : "Off";
  const locale = localePreference === "system" ? deviceLocale : localePreference;

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    syncWorkbenchUrl(activePanel, skin, "replace");
    if (configReady) {
      void api("/api/config", { method: "PATCH", body: { theme: skin } });
      void api("/api/workspace", { method: "PATCH", body: { activePanel } });
    }
  }, [activePanel, skin, configReady]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.localePreference = localePreference;
    if (configReady) void api("/api/config", { method: "PATCH", body: { locale: localePreference } });
  }, [locale, localePreference, configReady]);

  useEffect(() => {
    const syncDeviceLocale = () => setDeviceLocale(readDeviceUiLocale());
    window.addEventListener("languagechange", syncDeviceLocale);
    return () => window.removeEventListener("languagechange", syncDeviceLocale);
  }, []);

  useEffect(() => {
    localStorage.setItem(RAIL_COLLAPSED_KEY, String(railCollapsed));
  }, [railCollapsed]);

  useEffect(() => {
    if (!configReady) return;
    const normalized = normalizeAiSettings(aiSettings);
    void api("/api/config", {
      method: "PATCH",
      body: {
        ai: {
          endpoint: normalized.baseUrl,
          protocol: normalized.protocol,
          endpointPresetId: normalized.endpointPresetId,
          compatibilityFamily: normalized.compatibilityFamily,
          modelId: normalized.modelId,
          routeMode: normalized.routeMode,
          jsonMode: normalized.jsonMode,
          capabilities: enabledAiCapabilities(normalized),
          ...(aiApiKey.trim() ? { apiKey: aiApiKey } : {})
        }
      }
    }).then((config) => setHasSavedApiKey(config.ai.hasApiKey));
  }, [aiSettings, aiApiKey, configReady]);

  useEffect(() => {
    syncAiAssistUrl(aiAssistEnabled, "replace");
    if (configReady) void api("/api/config", { method: "PATCH", body: { aiAssistEnabled } });
  }, [aiAssistEnabled, configReady]);

  useEffect(() => {
    function onPopState() {
      const next = readUrlState();
      setActivePanel(next.panel);
      setSkin(next.skin ?? DEFAULT_SKIN);
      if (next.aiAssist !== null) setAiAssistEnabled(next.aiAssist);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    void loadCreatorState();
  }, []);

  async function loadCreatorState() {
    const [nextEditor, config, projectResult, workspaceState] = await Promise.all([
      api("/api/editor"),
      api("/api/config"),
      api("/api/projects"),
      api("/api/workspace")
    ]);
    setEditor(nextEditor);
    setProjects(projectResult.projects ?? []);
    setActiveProjectId(config.activeProjectId);
    setHasSavedApiKey(Boolean(config.ai?.hasApiKey));
    setAiSettings(aiSettingsFromConfig(config.ai));
    setLocalePreference(normalizeUiLocalePreference(config.locale));
    if (!initialUrlState.skin) setSkin(resolveSkinId(config.theme) ?? DEFAULT_SKIN);
    if (!initialUrlState.hasExplicitPanel && isKnownPanel(workspaceState.activePanel)) {
      setActivePanel(workspaceState.activePanel);
    }
    if (initialUrlState.aiAssist === null) setAiAssistEnabled(Boolean(config.aiAssistEnabled));
    setStatus(`${nextEditor.cards.length} cards loaded`);
    setConfigReady(true);
  }

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const isEditable = target?.closest?.("input, textarea, select, [contenteditable='true']");
      if (isEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (activePanel !== "preview") return;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") void swipe("left");
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") void swipe("right");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, play.sessionId, play.state]);

  useEffect(() => {
    if (!desktopClient) return undefined;
    function onDesktopShortcut(event) {
      if (!event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      let nextIndex = null;
      if (key === "tab") {
        const currentIndex = PANELS.findIndex(({ id }) => id === activePanel);
        nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + PANELS.length) % PANELS.length;
      } else if (/^[1-8]$/.test(key)) {
        nextIndex = Number(key) - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      openPanel(PANELS[nextIndex].id);
    }
    window.addEventListener("keydown", onDesktopShortcut);
    return () => window.removeEventListener("keydown", onDesktopShortcut);
  }, [activePanel, desktopClient, skin]);

  async function refreshEditor(options = {}) {
    const next = await api("/api/editor");
    setEditor(next);
    if (options.persistDraft) {
      await saveDraftSnapshot();
    }
    setStatus(options.statusMessage ?? `${next.cards.length} cards loaded`);
    return next;
  }

  async function runAction(label, action) {
    setBusy(label);
    try {
      const result = await action();
      return result ?? true;
    } catch (error) {
      setStatus(error.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function mutateEditor(label, action, successMessage) {
    return runAction(label, async () => {
      await pushHistory();
      await action();
      await refreshEditor({ persistDraft: true, statusMessage: successMessage ?? label });
    });
  }

  async function saveDraftSnapshot() {
    setDraftInfo(null);
  }

  async function importBundle(bundle) {
    return mutateEditor(
      "Importing content",
      async () => api("/api/editor/import", { method: "POST", body: { bundle } }),
      "Content imported"
    );
  }

  async function restoreDraft() {
    await runAction("Restoring draft", async () => {
      const draft = readStoredDraft();
      if (!draft) {
        clearStoredDraft();
        setDraftInfo(null);
        setStatus("No local draft found");
        return;
      }
      await api("/api/editor/restore", { method: "POST", body: { bundle: draft.bundle } });
      clearStoredDraft();
      setDraftInfo(null);
      await refreshEditor({ statusMessage: "Local draft restored" });
    });
  }

  function discardDraft() {
    clearStoredDraft();
    setDraftInfo(null);
    setStatus("Local draft discarded");
  }

  async function refreshProjects() {
    const result = await api("/api/projects");
    setProjects(result.projects ?? []);
    const config = await api("/api/config");
    setActiveProjectId(config.activeProjectId);
  }

  async function createProject(source) {
    await runAction("Creating project", async () => {
      await api("/api/projects", { method: "POST", body: { source } });
      historyRef.current = [];
      setHistoryDepth(0);
      await Promise.all([refreshEditor({ statusMessage: "Project created" }), refreshProjects()]);
    });
  }

  async function openProject(projectId) {
    if (!projectId || projectId === activeProjectId) return;
    await runAction("Opening project", async () => {
      await api(`/api/projects/${encodeURIComponent(projectId)}/open`, { method: "POST", body: {} });
      historyRef.current = [];
      setHistoryDepth(0);
      setDiagnostics(null);
      setPlay({ sessionId: null, state: null });
      await Promise.all([refreshEditor({ statusMessage: "Project opened" }), refreshProjects()]);
    });
  }

  async function deleteActiveProject() {
    if (!activeProjectId || !window.confirm("Delete the active project from this workspace?")) return;
    await runAction("Deleting project", async () => {
      await api(`/api/projects/${encodeURIComponent(activeProjectId)}`, { method: "DELETE" });
      await Promise.all([refreshEditor({ statusMessage: "Project deleted" }), refreshProjects()]);
    });
  }

  async function clearSavedApiKey() {
    const config = await api("/api/config", { method: "PATCH", body: { clearApiKey: true } });
    setAiApiKey("");
    setHasSavedApiKey(Boolean(config.ai.hasApiKey));
    setStatus("Saved API key cleared");
  }

  async function startPreview() {
    await runAction("Starting preview", async () => {
      const state = await api("/api/play/start", {
        method: "POST",
        body: { locale }
      });
      setPlay({ sessionId: state.sessionId, state });
      setStatus("Preview session started");
    });
  }

  async function swipe(direction) {
    if (!play.sessionId || play.state?.gameOver || !play.state?.currentCard) return;
    const state = await api("/api/play/swipe", {
      method: "POST",
      body: { sessionId: play.sessionId, direction }
    });
    setPlay((current) => ({ ...current, state }));
  }

  async function runDiagnostics(form) {
    await runAction("Running diagnostics", async () => {
      const result = await api("/api/diagnostics/run", { method: "POST", body: form });
      setDiagnostics(result);
      setStatus(`Diagnostics complete: ${result.healthScore}/100`);
    });
  }

  async function buildAiEditPlan(form) {
    return runAction("Building AI Assist draft", async () => {
      const result = await api("/api/ai/edit/plan", {
        method: "POST",
        body: {
          ...form,
          credentials: {
            apiKey: aiApiKey
          }
        }
      });
      setStatus(`AI Assist draft ready: ${result.proposals?.length ?? 0} proposals`);
      return result;
    });
  }

  async function applyAiEditPlan(plan, proposalIds) {
    return mutateEditor(
      "Applying AI Assist draft",
      async () => api("/api/ai/edit/apply", { method: "POST", body: { plan, proposalIds } }),
      "AI Assist draft applied"
    );
  }

  async function prepareBuild(exportBuild = false) {
    await runAction(exportBuild ? "Exporting build" : "Preparing build", async () => {
      const result = await api(exportBuild ? "/api/build/export" : "/api/build/prepare", {
        method: "POST",
        body: {}
      });
      setBuild(result);
      setStatus(exportBuild ? `Exported ${result.outputPath}` : "Build preview prepared");
    });
  }

  function openPanel(panelId) {
    if (!isKnownPanel(panelId)) return;
    setActivePanel(panelId);
    syncWorkbenchUrl(panelId, skin, "push");
  }

  function openAiAssistDraft(request) {
    setAiAssistEnabled(true);
    setAiDraftRequest({
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      ...request
    });
    openPanel("ai-edit");
  }

  function openAiAssistPreflight(request) {
    setAiAssistEnabled(true);
    setAiPreflight({
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      source: request.source ?? "AI Assist",
      actionId: request.actionId ?? request.actionLabel ?? request.mode ?? "draft",
      actionLabel: request.actionLabel ?? request.actionId ?? "Draft",
      contextSummary: request.contextSummary ?? "Current project context",
      status: "editing",
      mode: "generate_cards",
      cardCount: 1,
      ...request
    });
  }

  function openAmbientAiAction(actionId, selection, prompt = "") {
    if (!selection) return;
    const targetCardId = selection.targetCardId ?? null;
    const targetLocale = locale;
    const promptSuffix = prompt.trim() ? `\n\nCreator direction: ${prompt.trim()}` : "";
    const selectedText = selection.text ? ` Selected text: "${selection.text}".` : "";
    const baseContext = `${selection.label}${selection.context ? ` · ${selection.context}` : ""}`;
    const actionMap = {
      rewrite: {
        actionLabel: "Rewrite selection",
        mode: "generate_cards",
        cardCount: 1,
        instruction: `Rewrite or improve the selected creator context. Context: ${baseContext}.${selectedText} Preserve binary left/right play and explain any story state impact.`
      },
      translate: {
        actionLabel: "Translate selection",
        mode: "generate_cards",
        cardCount: 1,
        instruction: `Translate the selected creator context to ${targetLocale}. Context: ${baseContext}.${selectedText} Preserve ids, tags, variables, and left/right meaning unless the creator direction says otherwise.`
      },
      explain: {
        actionLabel: "Explain selection",
        mode: "generate_cards",
        cardCount: 1,
        instruction: `Explain the selected creator context in actionable author-facing terms. Context: ${baseContext}.${selectedText} Identify what it controls and what to check next.`
      },
      branch: {
        actionLabel: "Branch from selection",
        mode: "generate_cards",
        cardCount: 2,
        instruction: `Draft a narrative branch from the selected context. Context: ${baseContext}.${selectedText} Include clear trigger conditions through author-owned tags, variables, or gauge thresholds.`
      }
    };
    const action = actionMap[actionId] ?? actionMap.explain;
    openAiAssistPreflight({
      source: "Ambient",
      actionId: `ambient-${actionId}`,
      actionLabel: action.actionLabel,
      mode: action.mode,
      targetCardId,
      cardCount: action.cardCount,
      contextSummary: baseContext,
      instruction: `${action.instruction}${promptSuffix}`
    });
  }

  function updateAiPreflight(changes) {
    setAiPreflight((current) => current ? { ...current, ...changes, status: "editing" } : current);
  }

  function buildAiPreflightDraft() {
    if (!aiPreflight) return;
    const request = {
      ...aiPreflight,
      autoBuild: true,
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`
    };
    setAiPreflight((current) => current ? { ...current, status: "building" } : current);
    setAiDraftRequest(request);
    setAiPreflight(null);
    openPanel("ai-edit");
  }

  function openAiPreflightInPanel() {
    if (!aiPreflight) return;
    setAiDraftRequest({
      ...aiPreflight,
      autoBuild: false,
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`
    });
    setAiPreflight(null);
    openPanel("ai-edit");
  }

  function focusOnCard(cardId) {
    if (!cardId) return;
    setFocusCardId(cardId);
    openPanel("content");
  }

  function changeSkin(nextSkin) {
    const resolvedSkin = resolveSkinId(nextSkin);
    if (!resolvedSkin) return;
    setSkin(resolvedSkin);
    syncWorkbenchUrl(activePanel, resolvedSkin, "replace");
  }

  function changeLocale(nextLocale) {
    setLocalePreference(normalizeUiLocalePreference(nextLocale));
  }

  const playerHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("skin", resolveSkinId(skin) ?? DEFAULT_SKIN);
    params.set("locale", locale);
    if (desktopClient) params.set("client", "desktop");
    return import.meta.env.VITE_CREATOR_HOST === "browser"
      ? `${withBasePath("/workbench/preview")}?${params.toString()}`
      : `/play?${params.toString()}`;
  }, [skin, locale, desktopClient]);

  return (
    <LocaleContext.Provider value={locale}>
    <div className="app-shell" data-client={desktopClient ? "desktop" : "web"}>
      {aiAssistEnabled && (
        <AiAmbientLayer
          activePanelLabel={activePanelLabel}
          graphSelection={aiGraphSelection}
          onAction={openAmbientAiAction}
        />
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}logo-alpha.png`} alt="" />
          </span>
          <div>
            <h1>ReignsAgent</h1>
            <p>{editor?.metadata?.title ?? "Project workspace"}</p>
          </div>
        </div>
        <div className="topbar__readout" aria-label="Current workspace state">
          <span>{tr(locale, activePanelLabel)}</span>
          <span>{editor?.cards?.length ?? 0} {tr(locale, "cards")}</span>
          <span>{tr(locale, playerReady ? "player ready" : "player blocked")}</span>
        </div>
        <div className="topbar__tools">
          <label className="skin-select">
            {tr(locale, "Project")}
            <select value={activeProjectId ?? ""} onChange={(event) => void openProject(event.target.value)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <details className="project-actions" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute("open"); }}>
            <summary className="link-button" aria-label={tr(locale, "Manage project")} title={tr(locale, "Manage project")}><span aria-hidden="true">•••</span></summary>
            <div className="project-actions__menu">
              <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void createProject("blank"); }}>{tr(locale, "New blank project")}</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void createProject("sample"); }}>{tr(locale, "New from sample")}</button>
              <button className="project-actions__danger" type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void deleteActiveProject(); }}>{tr(locale, "Delete project")}</button>
            </div>
          </details>
          <button
            className={`ai-presence ai-presence--${aiPresenceState}`}
            type="button"
            onClick={() => setAiAssistEnabled((enabled) => !enabled)}
            aria-pressed={aiAssistEnabled}
            title={aiConfigured ? "Toggle ambient AI mode" : "AI mode can run local draft previews; configure an endpoint in Settings"}
          >
            <span className="ai-presence__orb" aria-hidden="true">
              <span className="ai-presence__core" />
            </span>
            <span className="ai-presence__copy">
              <strong>AI</strong>
              <small>{tr(locale, aiPresenceLabel)}</small>
            </span>
            <span className="ai-presence__wave" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <label className="skin-select">
            {tr(locale, "Skin")}
            <select value={skin} onChange={(event) => changeSkin(event.target.value)}>
              {SKINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <a className="link-button player-launch" href={playerHref} aria-label={tr(locale, "Open player preview")}>
            <span>{tr(locale, "Player")}</span>
          </a>
        </div>
      </header>

      <div className={railCollapsed ? "workspace workspace--rail-collapsed" : "workspace"}>
        <nav className="rail" aria-label="Creator panels">
          {PANELS.map(({ id, label, group }, index) => (
            <button
              key={id}
              className={activePanel === id ? "rail__item rail__item--active" : "rail__item"}
              type="button"
              onClick={() => openPanel(id)}
              aria-label={tr(locale, label)}
              title={desktopClient ? `${tr(locale, label)} · Ctrl+${index + 1}` : tr(locale, label)}
            >
              <span className="phantom-shape-wrapper" aria-hidden="true">
                <span className="phantom-shape phantom-shape--red phantom-jelly" />
                <span className="phantom-shape phantom-shape--cyan phantom-jelly" />
              </span>
              <span className="rail__icon"><PanelIcon id={id} /></span>
              <span className="rail__meta"><span className="rail__index">{String(index + 1).padStart(2, "0")}</span><span className="rail__group"> / {tr(locale, group)}</span></span>
              <span className="rail__label">{tr(locale, label)}</span>
              <small>{tr(locale, panelStatus(id, { editor, playerReady, diagnostics, build }))}</small>
            </button>
          ))}
          <button
            className="rail__toggle"
            type="button"
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
            aria-expanded={!railCollapsed}
            aria-label={tr(locale, railCollapsed ? "Expand navigation" : "Collapse navigation")}
            title={tr(locale, railCollapsed ? "Expand navigation" : "Collapse navigation")}
          >
            <span aria-hidden="true">{railCollapsed ? "»" : "«"}</span>
          </button>
        </nav>

        <main className="stage">
          <div className="stage__status" role="status">
            <span>{tr(locale, desktopClient ? "Desktop session" : import.meta.env.VITE_CREATOR_HOST === "browser" ? "Browser workspace" : "Local session")}</span>
            <strong>{busy || status}</strong>
          </div>
          {draftInfo && (
            <DraftBanner
              draftInfo={draftInfo}
              onRestore={restoreDraft}
              onDiscard={discardDraft}
            />
          )}
          {activePanel === "overview" && (
            <Overview
              editor={editor}
              playerReady={playerReady}
              diagnostics={diagnostics}
              build={build}
              aiAssistEnabled={aiAssistEnabled}
              aiConfigured={aiConfigured}
              onOpen={openPanel}
              onToggleAi={() => setAiAssistEnabled((enabled) => !enabled)}
              onAiAction={openAiAssistPreflight}
              activeAiAction={aiPreflight}
            />
          )}
          {activePanel === "content" && (
            <ContentPanel
              editor={editor}
              assetsByCard={assetsByCard}
              onImport={importBundle}
              onMutate={mutateEditor}
              onStatus={setStatus}
              focusCardId={focusCardId}
              aiAssistEnabled={aiAssistEnabled}
              onAiAction={openAiAssistPreflight}
              activeAiAction={aiPreflight}
            />
          )}
          {activePanel === "story" && (
            <StoryPanel
              editor={editor}
              diagnostics={diagnostics}
              onOpen={openPanel}
              onFocusCard={focusOnCard}
              onPushHistory={pushHistory}
              onUndo={undo}
              historyDepth={historyDepth}
              aiAssistEnabled={aiAssistEnabled}
              onAiAction={openAiAssistPreflight}
              activeAiAction={aiPreflight}
              onAiGraphSelection={setAiGraphSelection}
            />
          )}
          {activePanel === "review" && (
            <ReviewPanel
              editor={editor}
              diagnostics={diagnostics}
              aiAssistEnabled={aiAssistEnabled}
              onRun={runDiagnostics}
              onOpen={openPanel}
              onFocusCard={focusOnCard}
              onAiAction={openAiAssistPreflight}
              activeAiAction={aiPreflight}
            />
          )}
          {activePanel === "ai-edit" && (
            <AiAssistPanel
              editor={editor}
              diagnostics={diagnostics}
              aiSettings={aiSettings}
              apiKeyAvailable={Boolean(aiApiKey.trim()) || hasSavedApiKey}
              aiAssistEnabled={aiAssistEnabled}
              aiConfigured={aiConfigured}
              draftRequest={aiDraftRequest}
              onBuildPlan={buildAiEditPlan}
              onApplyPlan={applyAiEditPlan}
              onOpen={openPanel}
            />
          )}
          {activePanel === "preview" && (
            <PreviewPanel
              play={play}
              assetsByCard={assetsByCard}
              playerReady={playerReady}
              onStart={startPreview}
              onSwipe={swipe}
            />
          )}
          {activePanel === "build" && <BuildPanel build={build} onPrepare={prepareBuild} />}
          {activePanel === "settings" && (
            <SettingsPanel
              editor={editor}
              aiSettings={aiSettings}
              apiKey={aiApiKey}
              apiKeySaved={hasSavedApiKey}
              locale={locale}
              localePreference={localePreference}
              onLocaleChange={changeLocale}
              onAiSettingsChange={setAiSettings}
              onApiKeyChange={setAiApiKey}
              onApiKeyClear={clearSavedApiKey}
              onRefresh={refreshEditor}
              onStatus={setStatus}
            />
          )}
          {aiPreflight && (
            <AiAssistPreflight
              request={aiPreflight}
              aiConfigured={aiConfigured}
              diagnostics={diagnostics}
              onChange={updateAiPreflight}
              onClose={() => setAiPreflight(null)}
              onBuild={buildAiPreflightDraft}
              onOpenPanel={openAiPreflightInPanel}
            />
          )}
        </main>
      </div>
    </div>
    </LocaleContext.Provider>
  );
}

function Overview({ editor, playerReady, diagnostics, build, aiAssistEnabled, aiConfigured, onOpen, onToggleAi, onAiAction, activeAiAction }) {
  const [brief, setBrief] = useState("");
  const cardCount = editor?.cards?.length ?? 0;
  const title = editor?.metadata?.title ?? "Untitled";
  const sampleLike = /open court|oss|sample/i.test(title) || cardCount === 23;

  return (
    <section className="panel">
      <PanelHead title="Project Overview" note="Workspace health, content readiness, and next actions." />
      <div className="metric-grid">
        <Metric label="Project" value={title} />
        <Metric label="Cards" value={String(cardCount)} />
        <Metric label="Validation" value={editor?.validation?.valid ? "Valid" : "Needs work"} tone={editor?.validation?.valid ? "good" : "bad"} localizeValue />
        <Metric label="Player-ready" value={playerReady ? "Ready" : "Blocked"} tone={playerReady ? "good" : "bad"} localizeValue />
        <Metric label="Review" value={diagnostics ? `${diagnostics.healthScore}/100` : "Not run"} localizeValue={!diagnostics} />
        <Metric label="Build" value={build ? "Prepared" : "Not prepared"} localizeValue />
      </div>
      <div className={`overview-ai ${aiAssistEnabled ? "overview-ai--active" : ""}`}>
        <div className="overview-ai__head">
          <div>
            <h3>{cardCount === 0 ? "Start with AI Assist" : sampleLike ? "Adapt the sample with AI Assist" : "Shape this project with AI Assist"}</h3>
            <p>
              {aiConfigured
                ? "Use the current project context and optional brief to prepare draft cards, repair review issues, or expand story structure."
                : "Configure an endpoint when ready. Until then, AI Assist can still preview local draft plans over the current project context."}
            </p>
          </div>
          <span>{aiAssistEnabled ? "assist visible" : "assist hidden"}</span>
        </div>
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="Premise, tone, branch depth, endings, or constraints for the next AI draft..."
          rows={3}
        />
        <div className="action-row">
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => aiAssistEnabled
              ? onAiAction({
                source: "Overview",
                actionId: "project-draft",
                actionLabel: cardCount === 0 ? "Start project" : sampleLike ? "Adapt sample" : "Project draft",
                mode: "generate_cards",
                cardCount: cardCount === 0 ? 6 : 3,
                contextSummary: `${title} · ${cardCount} cards · review ${diagnostics ? `${diagnostics.healthScore}/100` : "not run"}`,
                instruction: brief.trim()
                  ? brief.trim()
                  : cardCount === 0
                    ? "Draft a compact playable starting set with at least two visible story branches, clear tags or variables, and binary left/right choices."
                    : "Draft a small expansion plan for the current project. Preserve existing tone, add clearer branches, and explain any suggested tags or variables."
              })
              : onOpen("ai-edit")}
          >
            Draft in AI Assist
          </button>
          <button className="btn" type="button" onClick={() => onOpen("content")}>Open Content</button>
          <button className="btn" type="button" onClick={() => onOpen("story")}>Open Story</button>
          <button className="btn btn--ghost" type="button" onClick={onToggleAi}>{aiAssistEnabled ? "Hide AI Assist" : "Show AI Assist"}</button>
        </div>
      </div>
      <div className="action-row">
        <button className="btn btn--primary" onClick={() => onOpen("content")}>Edit cards</button>
        <button className="btn" onClick={() => onOpen("review")}>Run review</button>
        <button className="btn" onClick={() => onOpen("preview")}>Preview</button>
        <button className="btn" onClick={() => onOpen("build")}>Build</button>
      </div>
    </section>
  );
}

function DraftBanner({ draftInfo, onRestore, onDiscard }) {
  return (
    <div className="draft-banner" role="status">
      <div>
        <strong>Local draft available</strong>
        <span>{draftInfo.cardCount ?? 0} cards · {formatDraftTime(draftInfo.savedAt)}</span>
      </div>
      <div className="draft-banner__actions">
        <button className="btn btn--primary" type="button" onClick={() => void onRestore()}>Restore</button>
        <button className="btn btn--ghost" type="button" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}

function ContentPanel({ editor, assetsByCard, onImport, onMutate, onStatus, focusCardId, aiAssistEnabled, onAiAction, activeAiAction }) {
  const [paste, setPaste] = useState("");
  const [query, setQuery] = useState("");
  const [validationFilter, setValidationFilter] = useState("all");
  const [selectedCardId, setSelectedCardId] = useState(null);
  const tagCatalog = useTagCatalog(editor);
  const gaugeLabels = useMemo(() => createGaugeLabels(editor?.metadata?.presentation), [editor?.metadata?.presentation]);

  const cardItems = useMemo(() => (editor?.cards ?? []).map((card, index) => ({
    card,
    validation: cardValidationState(editor, card, index)
  })), [editor]);

  const visibleItems = useMemo(() => {
    return cardItems.filter(({ card, validation }) => {
      if (!matchesCardQuery(card, query)) return false;
      if (validationFilter === "invalid") return validation.invalid;
      if (validationFilter === "player-ready") return !validation.invalid;
      return true;
    });
  }, [cardItems, query, validationFilter]);

  useEffect(() => {
    if (focusCardId && cardItems.some(({ card }) => card.id === focusCardId)) {
      setSelectedCardId(focusCardId);
      // Clear the filters so the focused card is guaranteed visible.
      setQuery("");
      setValidationFilter("all");
      return;
    }
    if (visibleItems.length === 0) {
      setSelectedCardId(null);
      return;
    }
    if (!selectedCardId || !visibleItems.some(({ card }) => card.id === selectedCardId)) {
      setSelectedCardId(visibleItems[0].card.id);
    }
  }, [focusCardId, cardItems, visibleItems, selectedCardId]);

  const activeIndex = visibleItems.findIndex(({ card }) => card.id === selectedCardId);
  const activeItem = activeIndex >= 0 ? visibleItems[activeIndex] : null;

  async function loadSample() {
    try {
      const sample = await api("/api/samples/oss-court");
      await onImport(sample);
    } catch (error) {
      onStatus(error.message);
    }
  }

  async function importPasted() {
    try {
      const imported = await onImport(JSON.parse(paste));
      if (imported) setPaste("");
    } catch (error) {
      onStatus(error.message);
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      await onImport(await readJsonFile(file, ["content.json"]));
    } catch (error) {
      onStatus(error.message);
    }
  }

  function selectRelative(step) {
    if (activeIndex < 0) return;
    const next = visibleItems[activeIndex + step];
    if (next) setSelectedCardId(next.card.id);
  }

  return (
    <section className="panel panel--content">
      <PanelHead title="Content / Cards" note="Card text, left/right choices, faction effects, tags, variables, and art bindings." />
      <div className="tool-strip">
        <label className="file-button">
          <input type="file" accept=".json,.zip,application/json,application/zip" onChange={(event) => void importFile(event.target.files?.[0])} />
          Import project
        </label>
        <button className="btn" onClick={() => void loadSample()}>Load sample deck</button>
        <span className="muted">{editor?.cards?.length ?? 0} cards</span>
      </div>
      <div className="editor-controls" aria-label="Card filters">
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="id, text, choice"
          />
        </label>
        <label>
          State
          <select value={validationFilter} onChange={(event) => setValidationFilter(event.target.value)}>
            <option value="all">All cards</option>
            <option value="player-ready">Player-ready</option>
            <option value="invalid">Invalid</option>
          </select>
        </label>
        <span className="muted">{visibleItems.length} shown</span>
      </div>
      <textarea
        className="json-paste"
        value={paste}
        onChange={(event) => setPaste(event.target.value)}
        placeholder="Paste content bundle JSON"
        rows={4}
      />
      <button className="btn btn--primary" disabled={!paste.trim()} onClick={() => void importPasted()}>Import pasted JSON</button>
      <div className="content-workspace">
        <aside className="card-switcher">
          <div className="card-switcher__head">
            <strong>{visibleItems.length} cards</strong>
            <span>{selectedCardId ? `${activeIndex + 1} / ${visibleItems.length}` : "0 / 0"}</span>
          </div>
          <div className="card-switcher__list" role="tablist" aria-label="Cards">
            {visibleItems.map(({ card, validation }) => (
              <button
                key={card.id}
                className={card.id === selectedCardId ? "card-switcher__item card-switcher__item--active" : "card-switcher__item"}
                type="button"
                role="tab"
                aria-selected={card.id === selectedCardId}
                data-ai-target="card"
                data-ai-label={card.id}
                data-ai-context={cardExcerpt(card)}
                data-ai-card-id={card.id}
                onClick={() => setSelectedCardId(card.id)}
              >
                <div className="card-switcher__meta">
                  <strong>{card.id}</strong>
                  <span className={validation.invalid ? "card-badge card-badge--invalid" : "card-badge card-badge--ready"}>
                    {validation.invalid ? "invalid" : "ready"}
                  </span>
                </div>
                <p>{cardExcerpt(card)}</p>
                <small>{validation.messages.length > 0 ? `${validation.messages.length} messages` : "No validation messages"}</small>
              </button>
            ))}
            {visibleItems.length === 0 && <div className="empty-inline">No cards match the current filters.</div>}
          </div>
          <AddCard onMutate={onMutate} onCreated={setSelectedCardId} />
        </aside>

        <div className="content-detail">
          {activeItem ? (
            <>
              <div className="content-detail__toolbar">
                <div>
                  <strong>{activeItem.card.id}</strong>
                  <span>{activeIndex + 1} of {visibleItems.length}</span>
                </div>
                <div className="content-detail__nav">
                  <button className="btn btn--ghost" type="button" disabled={activeIndex <= 0} onClick={() => selectRelative(-1)}>Previous</button>
                  <button className="btn btn--ghost" type="button" disabled={activeIndex === -1 || activeIndex >= visibleItems.length - 1} onClick={() => selectRelative(1)}>Next</button>
                </div>
              </div>
              <CardEditor
                key={activeItem.card.id}
                card={activeItem.card}
                asset={assetsByCard.get(activeItem.card.id)}
                validation={activeItem.validation}
                onMutate={onMutate}
                onStatus={onStatus}
                tagCatalog={tagCatalog}
                gaugeLabels={gaugeLabels}
              />
            </>
          ) : (
            <div className="empty-state">
              <p>No cards match the current filters.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CardEditor({ card, asset, validation, onMutate, onStatus, tagCatalog, gaugeLabels }) {
  const [text, setText] = useState(card.text ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setText(card.text ?? "");
    setConfirmDelete(false);
  }, [card.id, card.text]);

  async function saveText() {
    if (text === (card.text ?? "")) return;
    await onMutate(
      `Saving ${card.id}`,
      async () => api(`/api/editor/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        body: { changes: { text } }
      }),
      `Saved ${card.id}`
    );
  }

  async function removeCard() {
    await onMutate(
      `Deleting ${card.id}`,
      async () => api(`/api/editor/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" }),
      `Deleted ${card.id}`
    );
  }

  const invalid = validation.invalid;
  const messages = validation.messages;

  return (
    <article className="card-editor" data-ai-target="card" data-ai-label={card.id} data-ai-context={cardExcerpt(card)} data-ai-card-id={card.id}>
      <div className="card-editor__head">
        {asset ? <img src={`/${asset.uri}`} alt="" /> : <span className="art-placeholder" />}
        <div>
          <strong>{card.id}</strong>
          <p>{(card.choices ?? []).map((choice) => choice.id).join(" / ")}</p>
        </div>
        <div className="card-editor__actions">
          <span className={invalid ? "card-badge card-badge--invalid" : "card-badge card-badge--ready"}>
            {invalid ? "invalid" : "player-ready"}
          </span>
          <button className="icon-button" title="Delete card" type="button" onClick={() => setConfirmDelete(true)}>x</button>
        </div>
      </div>
      <div className="card-editor__meta">
        <label className="readonly-field">
          Card id
          <input value={card.id} readOnly />
        </label>
        <label className="readonly-field">
          Asset
          <input value={asset?.uri ?? "none"} readOnly />
        </label>
      </div>
      {messages.length > 0 && (
        <ul className="validation-list">
          {messages.map((message, index) => (
            <li key={`${message.level}-${index}`} className={`validation-list__item validation-list__item--${message.level}`}>
              {message.text}
            </li>
          ))}
        </ul>
      )}
      {confirmDelete && (
        <div className="confirm-row">
          <span>Delete this card?</span>
          <button className="btn btn--danger" type="button" onClick={() => void removeCard()}>Delete</button>
          <button className="btn btn--ghost" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      )}
      <AuthorSummary card={card} validation={validation} tagCatalog={tagCatalog} gaugeLabels={gaugeLabels} />
      <div className="field-row">
        <input value={text} onChange={(event) => setText(event.target.value)} aria-label={`${card.id} text`} />
        <button className="btn" disabled={text === (card.text ?? "")} onClick={() => void saveText()}>Save text</button>
      </div>
      <RequirementEditor card={card} tagCatalog={tagCatalog} onMutate={onMutate} onStatus={onStatus} />
      <div className="choice-grid">
        {(card.choices ?? []).map((choice) => (
          <ChoiceEditor
            key={choice.id}
            cardId={card.id}
            choice={choice}
            onMutate={onMutate}
            onStatus={onStatus}
            gaugeLabels={gaugeLabels}
          />
        ))}
      </div>
    </article>
  );
}

function AuthorSummary({ card, validation, tagCatalog, gaugeLabels }) {
  const requirementRows = describeRequirements(card.requirements, tagCatalog, gaugeLabels);
  const choices = card.choices ?? [];
  const issueCount = validation?.messages?.length ?? 0;

  return (
    <section className="author-summary" aria-label={`${card.id} author summary`}>
      <div className="author-summary__head">
        <div>
          <span>Story state</span>
          <strong>{card.id}</strong>
        </div>
        <span className={validation?.invalid ? "author-summary__status author-summary__status--invalid" : "author-summary__status"}>
          {validation?.invalid ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : "Ready"}
        </span>
      </div>

      <div className="author-summary__grid">
        <div className="author-summary__section">
          <span className="author-summary__label">Appears when</span>
          <div className="author-summary__rows">
            {requirementRows.map((row) => (
              <div className="author-summary__row" key={row.key}>
                <span className="author-summary__row-label">{row.label}</span>
                <div className="author-summary__chips">
                  {row.tags.length > 0 ? row.tags.map((tag) => (
                    <span className={`author-summary__chip author-summary__chip--${row.tone}`} key={tag.key}>
                      <span>{tag.label}</span>
                      {tag.label !== tag.key && <code>{tag.key}</code>}
                    </span>
                  )) : (
                    <span className={`author-summary__chip author-summary__chip--${row.tone}`}>
                      <span>{row.note}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="author-summary__section">
          <span className="author-summary__label">Choice outcomes</span>
          <div className="author-summary__choices">
            {choices.map((choice) => {
              const effects = describeChoiceEffects(choice.effects, tagCatalog, gaugeLabels);
              return (
                <div className="author-summary__choice" key={choice.id}>
                  <div className="author-summary__choice-head">
                    <strong>{choice.id}</strong>
                    <span>{choice.label || "Untitled choice"}</span>
                  </div>
                  <div className="author-summary__chips">
                    {effects.map((effect, index) => (
                      <span className={`author-summary__chip author-summary__chip--${effect.tone}`} key={`${effect.label}-${index}`}>
                        <span>{effect.label}</span>
                        {effect.detail && <code>{effect.detail}</code>}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {choices.length === 0 && <span className="empty-inline">No choices configured</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * RequirementEditor edits a card's gating requirements (allTags / anyTags /
 * noneTags) with semantic labels drawn from the tag catalog. It replaces the
 * raw JSON editing path: creators pick from known tags by human name, or type a
 * new key. Changes submit the whole requirements object via PUT /api/editor/cards/:id.
 */
function RequirementEditor({ card, tagCatalog, onMutate, onStatus }) {
  const requirements = card.requirements ?? {};

  async function saveRequirements(next) {
    await onMutate(
      `Updating ${card.id} requirements`,
      async () => api(`/api/editor/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        body: { changes: { requirements: next } }
      }),
      `Updated ${card.id} requirements`
    );
  }

  function updateGroup(mode, nextTags) {
    const clean = nextTags.map((tag) => tag.trim()).filter(Boolean);
    const unique = [...new Set(clean)];
    const merged = { ...requirements };
    if (unique.length > 0) {
      merged[mode] = unique;
    } else {
      delete merged[mode];
    }
    void saveRequirements(merged);
  }

  const groups = [
    { mode: "allTags", heading: "Needs all of these tags", hint: "Card only appears when every tag here is set." },
    { mode: "anyTags", heading: "Needs any of these tags", hint: "Card appears when at least one tag here is set." },
    { mode: "noneTags", heading: "Blocked by these tags", hint: "Card is hidden while any of these tags is set." }
  ];

  return (
    <div className="requirement-editor">
      <div className="requirement-editor__head">
        <strong>When does this card appear?</strong>
        <span>Empty = always eligible</span>
      </div>
      {groups.map((group) => (
        <RequirementGroup
          key={group.mode}
          mode={group.mode}
          heading={group.heading}
          hint={group.hint}
          tags={requirements[group.mode] ?? []}
          tagCatalog={tagCatalog}
          onChange={(nextTags) => updateGroup(group.mode, nextTags)}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
}

/**
 * TagPicker is a skin-consistent replacement for <datalist>: a text input with
 * a filtered dropdown of known tags (showing human label + raw key). Selecting
 * an option calls onPick with the key; typing a novel key still works via the
 * input. Closes on escape, blur, or pick.
 */
function TagPicker({ value, onChange, onPick, tagCatalog, placeholder, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  const options = useMemo(() => {
    const normalized = (value ?? "").trim().toLowerCase();
    const all = tagCatalog?.tags ?? [];
    if (!normalized) return all;
    return all.filter((entry) => (
      entry.key.toLowerCase().includes(normalized) ||
      (entry.label ?? "").toLowerCase().includes(normalized)
    ));
  }, [value, tagCatalog]);

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  useEffect(() => {
    function onDocPointer(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, []);

  function choose(key) {
    onPick(key);
    setOpen(false);
  }

  function onKeyDown(event) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && options[highlight]) {
      event.preventDefault();
      choose(options[highlight].key);
    }
  }

  const showCreate = value && value.trim() && !options.some((entry) => entry.key === value.trim());

  return (
    <div className="tag-picker" ref={wrapperRef}>
      <input
        ref={inputRef}
        className="tag-picker__input"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="tag-picker__menu" role="listbox">
          {options.map((entry, index) => (
            <li key={entry.key} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                className={index === highlight ? "tag-picker__option tag-picker__option--active" : "tag-picker__option"}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(entry.key)}
              >
                <span className="tag-picker__label">{entry.label || entry.key}</span>
                <code className="tag-picker__key">{entry.key}</code>
              </button>
            </li>
          ))}
          {showCreate && (
            <li role="option">
              <button
                type="button"
                className="tag-picker__option tag-picker__option--create"
                onClick={() => choose(value.trim())}
              >
                <span className="tag-picker__label">Create new tag</span>
                <code className="tag-picker__key">{value.trim()}</code>
              </button>
            </li>
          )}
          {options.length === 0 && !showCreate && (
            <li className="tag-picker__empty">No matching tags. Type to create one.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function RequirementGroup({ mode, heading, hint, tags, tagCatalog, onChange, onStatus }) {
  const [draft, setDraft] = useState("");

  function removeTag(tag) {
    onChange(tags.filter((existing) => existing !== tag));
  }

  function addTag() {
    const value = draft.trim();
    if (!value) return;
    if (tags.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...tags, value]);
    setDraft("");
  }

  return (
    <div className="requirement-group">
      <div className="requirement-group__head">
        <span>{heading}</span>
        <small>{hint}</small>
      </div>
      <div className="requirement-chips">
        {tags.map((tag) => (
          <span key={tag} className="requirement-chip">
            <span className="requirement-chip__label">{tagDisplayName(tag, tagCatalog.byKey)}</span>
            <code className="requirement-chip__key">{tag}</code>
            <button
              className="requirement-chip__remove"
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(tag)}
            >x</button>
          </span>
        ))}
        {tags.length === 0 && <span className="empty-inline">No {mode} requirement</span>}
      </div>
      <div className="requirement-add">
        <TagPicker
          value={draft}
          onChange={setDraft}
          onPick={(key) => { onChange([...tags.filter((existing) => existing !== key), key]); setDraft(""); }}
          tagCatalog={tagCatalog}
          placeholder="Pick or type a tag key"
        />
        <button className="btn btn--ghost" type="button" disabled={!draft.trim()} onClick={() => addTag()}>Add</button>
      </div>
    </div>
  );
}

function ChoiceEditor({ cardId, choice, onMutate, onStatus, gaugeLabels }) {
  const [label, setLabel] = useState(choice.label ?? "");
  const [advanced, setAdvanced] = useState(JSON.stringify(choice.effects ?? {}, null, 2));
  const [factions, setFactions] = useState(() => createFactionDraft(choice.effects?.factions));

  useEffect(() => {
    setLabel(choice.label ?? "");
    setAdvanced(JSON.stringify(choice.effects ?? {}, null, 2));
    setFactions(createFactionDraft(choice.effects?.factions));
  }, [choice.id, choice.label, choice.effects]);

  async function saveLabel() {
    if (label === (choice.label ?? "")) return;
    await onMutate(
      `Saving ${choice.id} label`,
      async () => api(choicePath(cardId, choice.id), { method: "PATCH", body: { label } }),
      `Saved ${choice.id} label`
    );
  }

  async function saveFaction(faction) {
    const value = factions[faction] ?? "";
    const raw = value.trim();
    const current = choice.effects?.factions?.[faction];
    const label = gaugeDisplayName(faction, gaugeLabels);
    if (raw === "" && current === undefined) return;
    if (raw !== "" && Number(raw) === current) return;
    if (raw !== "" && !Number.isFinite(Number(raw))) {
      onStatus(`${label} must be finite`);
      setFactions(createFactionDraft(choice.effects?.factions));
      return;
    }
    const path = `${choicePath(cardId, choice.id)}/effects/faction/${faction}`;
    await onMutate(
      `Updating ${choice.id} ${label}`,
      async () => {
        if (raw === "") {
          await api(path, { method: "DELETE" });
        } else {
          await api(path, { method: "POST", body: { value: Number(raw) } });
        }
      },
      `Updated ${choice.id} ${label}`
    );
  }

  async function saveEffects() {
    let effects;
    try {
      effects = JSON.parse(advanced);
    } catch (error) {
      onStatus(error.message);
      return;
    }
    await onMutate(
      `Saving ${choice.id} effects`,
      async () => api(choicePath(cardId, choice.id), { method: "PATCH", body: { effects } }),
      `Saved ${choice.id} effects`
    );
  }

  return (
    <div className="choice-editor" data-ai-target="choice" data-ai-label={`${cardId}:${choice.id}`} data-ai-context={choice.label ?? choice.id} data-ai-card-id={cardId}>
      <div className="choice-editor__head">
        <strong>{choice.id}</strong>
        <input value={label} onChange={(event) => setLabel(event.target.value)} onBlur={() => void saveLabel()} placeholder="choice label" />
      </div>
      <div className="faction-grid">
        {FACTIONS.map((faction) => (
          <label key={faction}>
            <span className="faction-grid__name" title={faction}>{gaugeDisplayName(faction, gaugeLabels)}</span>
            <input
              type="number"
              value={factions[faction] ?? ""}
              onChange={(event) => setFactions((current) => ({ ...current, [faction]: event.target.value }))}
              onBlur={() => void saveFaction(faction)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
      <EffectRows
        title="Tags"
        kind="tag"
        entries={choice.effects?.tags ?? {}}
        cardId={cardId}
        choiceId={choice.id}
        onMutate={onMutate}
        onStatus={onStatus}
      />
      <EffectRows
        title="Variables"
        kind="variable"
        entries={choice.effects?.variables ?? {}}
        cardId={cardId}
        choiceId={choice.id}
        onMutate={onMutate}
        onStatus={onStatus}
      />
      <details>
        <summary>Advanced effects JSON</summary>
        <textarea value={advanced} onChange={(event) => setAdvanced(event.target.value)} rows={5} />
        <button className="btn" type="button" onClick={() => void saveEffects()}>Save effects JSON</button>
      </details>
    </div>
  );
}

function EffectRows({ title, kind, entries, cardId, choiceId, onMutate, onStatus }) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState(kind === "tag" ? "true" : "");
  const sortedEntries = useMemo(() => Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)), [entries]);

  async function applyEntry(key, rawValue) {
    const cleanedKey = key.trim();
    if (!cleanedKey) {
      onStatus(`${title} key required`);
      return false;
    }
    const value = kind === "tag" ? parseTagValue(rawValue) : parseScalar(rawValue);
    const path = effectPath(cardId, choiceId, kind, cleanedKey);
    const updated = await onMutate(
      `Updating ${choiceId} ${cleanedKey}`,
      async () => {
        if (value === null) {
          await api(path, { method: "DELETE" });
        } else {
          await api(path, { method: "POST", body: { value } });
        }
      },
      `Updated ${choiceId} ${cleanedKey}`
    );
    return updated;
  }

  async function removeEntry(key) {
    await onMutate(
      `Removing ${choiceId} ${key}`,
      async () => api(effectPath(cardId, choiceId, kind, key), { method: "DELETE" }),
      `Removed ${choiceId} ${key}`
    );
  }

  async function addEntry() {
    const updated = await applyEntry(newKey, newValue);
    if (updated) {
      setNewKey("");
      setNewValue(kind === "tag" ? "true" : "");
    }
  }

  return (
    <div className="effect-panel">
      <div className="effect-panel__head">
        <span>{title}</span>
        <small>{sortedEntries.length}</small>
      </div>
      <div className="effect-rows">
        {sortedEntries.map(([key, value]) => (
          <EffectEntryRow
            key={key}
            entryKey={key}
            value={value}
            onApply={(nextValue) => applyEntry(key, nextValue)}
            onRemove={() => removeEntry(key)}
          />
        ))}
        {sortedEntries.length === 0 && <span className="empty-inline">No entries</span>}
      </div>
      <div className="effect-row effect-row--new">
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder={`${kind} key`} />
        <input
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addEntry();
          }}
          placeholder="value"
        />
        <button className="btn btn--ghost" type="button" disabled={!newKey.trim()} onClick={() => void addEntry()}>Add</button>
      </div>
    </div>
  );
}

function EffectEntryRow({ entryKey, value, onApply, onRemove }) {
  const [draft, setDraft] = useState(formatEffectValue(value));

  useEffect(() => {
    setDraft(formatEffectValue(value));
  }, [entryKey, value]);

  const original = formatEffectValue(value);

  return (
    <div className="effect-row">
      <input className="effect-row__key" value={entryKey} readOnly />
      <input
        className="effect-row__value"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft !== original) void onApply(draft);
        }}
      />
      <button className="btn btn--ghost" type="button" disabled={draft === original} onClick={() => void onApply(draft)}>Apply</button>
      <button className="btn btn--ghost" type="button" onClick={() => void onRemove()}>Remove</button>
    </div>
  );
}

function AddCard({ onMutate, onCreated }) {
  const [id, setId] = useState("");
  const [text, setText] = useState("");

  async function createCard() {
    const nextId = id;
    const created = await onMutate(
      "Creating card",
      async () => api("/api/editor/cards", {
        method: "POST",
        body: {
          card: {
            id,
            text,
            choices: [
              { id: "left", label: "Left", effects: { factions: {} } },
              { id: "right", label: "Right", effects: { factions: {} } }
            ]
          }
        }
      }),
      "Card created"
    );
    if (created) {
      setId("");
      setText("");
      onCreated?.(nextId);
    }
  }

  return (
    <details className="add-card">
      <summary>Add card</summary>
      <div className="field-row">
        <input value={id} onChange={(event) => setId(event.target.value)} placeholder="card id" />
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="card text" />
        <button className="btn btn--primary" disabled={!id || !text} onClick={() => void createCard()}>Create</button>
      </div>
    </details>
  );
}

function StoryPanel({ editor, diagnostics, onOpen, onFocusCard, onPushHistory, onUndo, historyDepth = 0, aiAssistEnabled, onAiAction, activeAiAction, onAiGraphSelection }) {
  const [graph, setGraph] = useState(null);
  const [graphError, setGraphError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [renaming, setRenaming] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [graphFocusCardId, setGraphFocusCardId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const tagCatalog = useTagCatalog(editor);
  const storyGroups = useStoryGroups(editor);
  const gaugeLabels = useMemo(() => createGaugeLabels(editor?.metadata?.presentation), [editor?.metadata?.presentation]);

  const storyIssues = useMemo(() => deriveStoryIssues({
    graph,
    diagnostics,
    cards: editor?.cards ?? [],
    storyGroups: storyGroups.groups
  }), [graph, diagnostics, editor?.cards, storyGroups.groups]);
  const selectedStoryGroup = useMemo(() => {
    return storyGroups.groups.find((group) => group.id === selectedGroupId) ?? null;
  }, [storyGroups.groups, selectedGroupId]);
  const storyAiTarget = graphFocusCardId ?? selectedStoryGroup?.cardIds?.[0] ?? graph?.entryCards?.[0] ?? editor?.cards?.[0]?.id ?? null;

  useEffect(() => {
    if (selectedGroupId && !storyGroups.groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(null);
    }
  }, [storyGroups.groups, selectedGroupId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setGraphError("");
      try {
        const result = await api("/api/editor/graph");
        if (!cancelled) setGraph(result);
      } catch (error) {
        if (!cancelled) {
          setGraph(null);
          setGraphError(error.message);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [editor, refreshKey]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setFullscreen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  async function saveTagLabel(key, label) {
    await onPushHistory?.();
    const tagLabels = { ...(editor?.metadata?.tagLabels ?? {}) };
    if (label.trim()) {
      tagLabels[key] = label.trim();
    } else {
      delete tagLabels[key];
    }
    await api("/api/editor/metadata", { method: "PATCH", body: { metadata: { tagLabels } } });
    setRenaming(null);
  }

  return (
    <section className="panel panel--story">
      <PanelHead title="Story / Graph" note="Card-to-card transitions driven by tags. Click a node to edit it; rename tags for clarity." />
      <div className="metric-grid">
        <Metric label="Narrative nodes" value={`${editor?.cards?.length ?? 0} cards`} />
        <Metric
          label="Reachable"
          value={graph ? `${graph.reachableCards.length}/${graph.nodes.length}` : "loading"}
          tone={graph && graph.unreachableCards.length === 0 ? "good" : ""}
        />
        <Metric
          label="Unreachable"
          value={graph ? String(graph.unreachableCards.length) : "-"}
          tone={graph && graph.unreachableCards.length > 0 ? "bad" : ""}
        />
        <Metric
          label="Tags"
          value={String(tagCatalog.tags?.length ?? 0)}
        />
        <Metric
          label="Story groups"
          value={String(storyGroups.groups?.length ?? 0)}
        />
      </div>
      <div className="graph-controls">
        <button className="btn" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh graph</button>
        {diagnostics ? (
          <button className="btn btn--ghost" type="button" onClick={() => onOpen("review")}>
            Review diagnostics · {diagnostics.healthScore}/100
          </button>
        ) : (
          <span className="muted">Run review for simulation coverage</span>
        )}
        <StoryGroupFilter
          groups={storyGroups.groups}
          selectedGroupId={selectedGroupId}
          onSelect={setSelectedGroupId}
        />
        <GraphLegend hasHeat={Boolean(diagnostics?.coverage?.cardCycleRates || diagnostics?.coverage?.cardVisitRates)} />
      </div>
      {graphError ? (
        <div className="empty-state">
          <p>Could not load story graph: {graphError}</p>
        </div>
      ) : graph ? (
        graph.nodes.length === 0 ? (
          <div className="empty-state">
            <p>No cards to graph. Add or import cards first.</p>
          </div>
        ) : (
          <div className="story-layout">
            <StoryGraph
              graph={graph}
              cards={editor?.cards ?? []}
              onFocusCard={onFocusCard}
              tagCatalog={tagCatalog}
              gaugeLabels={gaugeLabels}
              onConnect={createConnection}
              onDisconnect={deleteConnection}
              onUndo={onUndo}
              historyDepth={historyDepth}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((value) => !value)}
              diagnostics={diagnostics}
              focusCardId={graphFocusCardId}
              activeGroupCardIds={selectedStoryGroup?.cardIds ?? []}
              aiAssistEnabled={aiAssistEnabled}
              onAiGraphSelection={onAiGraphSelection}
            />
            <aside className="story-inspector">
              <StoryGroupDirectory
                groups={storyGroups.groups}
                selectedGroupId={selectedGroupId}
                onSelect={setSelectedGroupId}
              />
              <StoryIssueList
                issues={storyIssues}
                focusCardId={graphFocusCardId}
                onFocusCard={setGraphFocusCardId}
                onEditCard={onFocusCard}
                onSelectGroup={setSelectedGroupId}
                onOpenReview={() => onOpen("review")}
              />
              <TagDirectory
                tags={tagCatalog.tags ?? []}
                renaming={renaming}
                onRename={setRenaming}
                onSaveLabel={saveTagLabel}
              />
            </aside>
          </div>
        )
      ) : (
        <div className="empty-state">
          <p>Building story graph...</p>
        </div>
      )}
    </section>
  );

  async function createConnection({ fromCardId, choiceId, toCardId, tagKey }) {
    await onPushHistory?.();
    // Set the tag on the source choice's effects...
    const sourceCard = editor?.cards?.find((card) => card.id === fromCardId);
    if (!sourceCard) return;
    const choice = sourceCard.choices?.find((item) => item.id === choiceId);
    if (!choice) return;
    const effects = { ...(choice.effects ?? {}) };
    effects.tags = { ...(effects.tags ?? {}), [tagKey]: true };
    await api(`/api/editor/cards/${encodeURIComponent(fromCardId)}/choices/${encodeURIComponent(choiceId)}`, {
      method: "PATCH",
      body: { effects }
    });
    // ...and add it to the target card's allTags requirement.
    const targetCard = editor?.cards?.find((card) => card.id === toCardId);
    if (targetCard) {
      const requirements = { ...(targetCard.requirements ?? {}) };
      const existing = requirements.allTags ?? [];
      if (!existing.includes(tagKey)) {
        requirements.allTags = [...existing, tagKey];
        await api(`/api/editor/cards/${encodeURIComponent(toCardId)}`, {
          method: "PUT",
          body: { changes: { requirements } }
        });
      }
    }
    setRefreshKey((value) => value + 1);
  }

  async function deleteConnection(edge) {
    const { from: fromCardId, to: toCardId, tags = [], choices = [] } = edge;
    const tagKey = tags[0];
    if (!tagKey) return;
    await onPushHistory?.();
    const choiceIds = choices.map((choice) => choice.id);

    // Remove the tag from each producing choice on the source card.
    const sourceCard = editor?.cards?.find((card) => card.id === fromCardId);
    if (sourceCard) {
      for (const choice of sourceCard.choices ?? []) {
        if (choiceIds.length > 0 && !choiceIds.includes(choice.id)) continue;
        const tags = choice.effects?.tags ?? {};
        if (!(tagKey in tags)) continue;
        await api(`${choicePath(fromCardId, choice.id)}/effects/tag/${encodeURIComponent(tagKey)}`, {
          method: "DELETE"
        });
      }
    }

    // Remove the tag from the target card's requirements (all/any/none).
    const targetCard = editor?.cards?.find((card) => card.id === toCardId);
    if (targetCard) {
      const requirements = { ...(targetCard.requirements ?? {}) };
      let changed = false;
      for (const mode of ["allTags", "anyTags", "noneTags"]) {
        const existing = requirements[mode];
        if (Array.isArray(existing) && existing.includes(tagKey)) {
          const next = existing.filter((tag) => tag !== tagKey);
          if (next.length > 0) requirements[mode] = next;
          else delete requirements[mode];
          changed = true;
        }
      }
      if (changed) {
        await api(`/api/editor/cards/${encodeURIComponent(toCardId)}`, {
          method: "PUT",
          body: { changes: { requirements } }
        });
      }
    }
    setRefreshKey((value) => value + 1);
  }
}

function StoryGroupFilter({ groups, selectedGroupId, onSelect }) {
  if (!groups || groups.length === 0) return null;
  return (
    <div className="story-group-filter" aria-label="Story group filter">
      <button
        className={!selectedGroupId ? "story-group-chip story-group-chip--active" : "story-group-chip"}
        type="button"
        onClick={() => onSelect(null)}
      >
        All story
      </button>
      {groups.map((group) => (
        <button
          key={group.id}
          className={selectedGroupId === group.id ? "story-group-chip story-group-chip--active" : "story-group-chip"}
          type="button"
          onClick={() => onSelect(group.id)}
          title={group.description ?? group.label}
        >
          {group.label}
        </button>
      ))}
    </div>
  );
}

function StoryGroupDirectory({ groups, selectedGroupId, onSelect }) {
  return (
    <section className="story-groups">
      <div className="story-groups__head">
        <strong>Story groups</strong>
        <small>{groups.length}</small>
      </div>
      {groups.length === 0 ? (
        <p className="muted">No chapters, themes, arcs, or endings defined in metadata.story.groups yet.</p>
      ) : (
        <ul className="story-groups__list">
          {groups.map((group) => (
            <li
              key={group.id}
              className={selectedGroupId === group.id ? "story-groups__item story-groups__item--active" : "story-groups__item"}
              data-ai-target="story group"
              data-ai-label={group.label}
              data-ai-context={`${group.type} · ${group.cardCount} cards`}
            >
              <button type="button" onClick={() => onSelect(selectedGroupId === group.id ? null : group.id)}>
                <span>{group.label}</span>
                <small>{group.type} · {group.cardCount} cards</small>
              </button>
              {group.description && <p>{group.description}</p>}
              {group.tags.length > 0 && <code>{group.tags.join(", ")}</code>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StoryIssueList({ issues, focusCardId, onFocusCard, onEditCard, onSelectGroup, onOpenReview }) {
  return (
    <section className="story-issues">
      <div className="story-issues__head">
        <div>
          <strong>Story issues</strong>
          <small>{issues.length}</small>
        </div>
        <button className="btn btn--ghost btn--compact" type="button" onClick={onOpenReview}>Review</button>
      </div>
      {issues.length === 0 ? (
        <p className="muted">No graph or review coverage issues in the current run.</p>
      ) : (
        <ul className="story-issues__list">
          {issues.map((issue) => (
            <li
              key={issue.key}
              className={`story-issues__item story-issues__item--${issue.tone} ${focusCardId === issue.cardId ? "story-issues__item--active" : ""}`}
              data-ai-target="story issue"
              data-ai-label={issue.label}
              data-ai-context={issue.detail}
              data-ai-card-id={issue.cardId ?? ""}
            >
              <div className="story-issues__meta">
                <span>{issue.label}</span>
                <code>{issue.cardId ?? issue.groupId}</code>
              </div>
              <small>{issue.detail}</small>
              {issue.excerpt && <p>{issue.excerpt}</p>}
              {issue.suggestion && (
                <div className="story-issues__repair">
                  <span>Recommended fix</span>
                  <p>{issue.suggestion}</p>
                </div>
              )}
              <div className="story-issues__actions">
                {issue.groupId && (
                  <button className="btn btn--ghost btn--compact" type="button" onClick={() => onSelectGroup?.(issue.groupId)}>Group</button>
                )}
                {issue.cardId && (
                  <>
                    <button className="btn btn--ghost btn--compact" type="button" onClick={() => onFocusCard?.(issue.cardId)}>Find</button>
                    <button className="btn btn--compact" type="button" onClick={() => onEditCard?.(issue.cardId)}>Edit</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function deriveStoryIssues({ graph, diagnostics, cards, storyGroups = [] }) {
  if (!graph) return [];
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const groupById = new Map((storyGroups ?? []).map((group) => [group.id, group]));
  const incomingByCard = countGraphEdges(graph.edges ?? [], "to");
  const outgoingByCard = countGraphEdges(graph.edges ?? [], "from");
  const issues = [];
  const seen = new Set();

  function pushIssue(kind, cardId, label, detail, tone) {
    if (!cardId || seen.has(`${kind}:${cardId}`)) return;
    const card = cardById.get(cardId);
    seen.add(`${kind}:${cardId}`);
    issues.push({
      key: `${kind}:${cardId}`,
      kind,
      cardId,
      label,
      detail,
      tone,
      suggestion: repairSuggestionForCardIssue({
        kind,
        card,
        incoming: incomingByCard.get(cardId) ?? 0,
        outgoing: outgoingByCard.get(cardId) ?? 0
      }),
      excerpt: storyCardExcerpt(card?.text)
    });
  }

  function pushGroupIssue(issue) {
    if (!issue?.groupId || seen.has(`group:${issue.code}:${issue.groupId}`)) return;
    const group = groupById.get(issue.groupId);
    const targetCardId = firstExistingCardId(issue.cardIds, cardById) ?? firstExistingCardId(group?.cardIds, cardById);
    seen.add(`group:${issue.code}:${issue.groupId}`);
    issues.push({
      key: `group:${issue.code}:${issue.groupId}`,
      kind: issue.code,
      groupId: issue.groupId,
      cardId: targetCardId,
      label: group?.label ?? issue.groupId,
      detail: issue.message ?? "Story group coverage needs review.",
      tone: issue.severity === "error" ? "bad" : "warn",
      suggestion: repairSuggestionForGroupIssue(issue, group),
      excerpt: targetCardId ? storyCardExcerpt(cardById.get(targetCardId)?.text) : ""
    });
  }

  for (const cardId of graph.unreachableCards ?? []) {
    pushIssue("unreachable", cardId, "Unreachable", "No static tag, variable, or gauge path reaches this card.", "bad");
  }
  for (const cardId of graph.isolatedCards ?? []) {
    pushIssue("isolated", cardId, "Isolated", "No incoming or outgoing story graph edges.", "warn");
  }

  const coverage = diagnostics?.coverage ?? {};
  for (const cardId of coverage.unvisitedCards ?? []) {
    pushIssue("unvisited", cardId, "Unvisited", "Monte Carlo review did not draw this card.", "bad");
  }
  for (const entry of coverage.lowCycleCards ?? []) {
    if (!entry?.cardId) continue;
    pushIssue("low-cycle", entry.cardId, "Low coverage", `Seen in only ${formatRate(entry.rate ?? 0)} of review cycles.`, "warn");
  }
  for (const issue of diagnostics?.narrative?.issues ?? []) {
    pushGroupIssue(issue);
  }

  return issues.sort((left, right) => {
    const toneRank = { bad: 0, warn: 1, info: 2 };
    const leftTarget = left.cardId ?? left.groupId ?? "";
    const rightTarget = right.cardId ?? right.groupId ?? "";
    return (toneRank[left.tone] ?? 9) - (toneRank[right.tone] ?? 9) || leftTarget.localeCompare(rightTarget);
  });
}

function countGraphEdges(edges, field) {
  const counts = new Map();
  for (const edge of edges) {
    const key = edge?.[field];
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function firstExistingCardId(cardIds = [], cardById) {
  return cardIds.find((cardId) => cardById.has(cardId)) ?? null;
}

function repairSuggestionForCardIssue({ kind, card, incoming, outgoing }) {
  if (kind === "unreachable") {
    const signal = describePrimaryRequirement(card);
    return signal
      ? `Add a reachable left/right choice that sets ${signal}, or relax this card's appearance requirement in Content.`
      : "Connect a reachable card into this one, or loosen its appearance conditions in Content.";
  }
  if (kind === "isolated") {
    if (incoming === 0 && outgoing === 0) {
      return "Use drag-to-connect to add an incoming route and an outgoing route, or remove the card if it is only a spare draft.";
    }
    if (incoming === 0) return "Add an incoming route from a reachable card so this card can enter the story.";
    if (outgoing === 0) return "Connect one of this card's left/right choices to a later card so it can continue the story.";
  }
  if (kind === "unvisited") {
    return "Open this card, check its requirements, then add another route or raise its weight; rerun Review after the edit.";
  }
  if (kind === "low-cycle") {
    return "Increase the card's weight, shorten its prerequisites, or add a second route into it; rerun Review to confirm coverage improves.";
  }
  return "Focus the card, adjust its requirements or outgoing choice effects, then rerun Review.";
}

function repairSuggestionForGroupIssue(issue, group) {
  if (issue.code === "empty_story_group") {
    return "Add matching cardIds or tags to this story group, or tag the intended cards so the group has something to review.";
  }
  if (issue.code?.includes("ending")) {
    return "Focus the listed ending card, add or strengthen routes into it, then rerun Review to confirm the ending is reachable.";
  }
  if (issue.code?.includes("unreachable") || issue.code?.includes("unvisited")) {
    return "Select the group, inspect its unvisited cards, then connect reachable choices into those cards or loosen their gates.";
  }
  if (issue.code?.includes("partial")) {
    return "Select the group and improve routes to the unvisited or low-cycle cards; rerun Review after the graph changes.";
  }
  return group?.cardCount > 0
    ? "Select this group, inspect its cards, and rerun Review after editing the weak route."
    : "Attach cards or tags to this group so Review can measure it.";
}

function describePrimaryRequirement(card) {
  const requirements = card?.requirements ?? {};
  if (requirements.allTags?.length) return `tag '${requirements.allTags[0]}'`;
  if (requirements.anyTags?.length) return `one of: ${requirements.anyTags.slice(0, 3).map((tag) => `'${tag}'`).join(", ")}`;
  const variable = Object.keys(requirements.variables ?? {})[0];
  if (variable) return `variable '${variable}'`;
  const faction = Object.keys(requirements.factions ?? {})[0];
  if (faction) return `gauge '${faction}'`;
  return "";
}

function storyCardExcerpt(text) {
  if (!text) return "";
  return text.length > 76 ? `${text.slice(0, 73)}...` : text;
}

function TagDirectory({ tags, renaming, onRename, onSaveLabel }) {
  if (tags.length === 0) {
    return (
      <section className="tag-directory">
        <div className="tag-directory__head">
          <strong>Story tags</strong>
        </div>
        <p className="muted">No tags yet. They appear once cards set or require them.</p>
      </section>
    );
  }
  return (
    <section className="tag-directory">
      <div className="tag-directory__head">
        <strong>Story tags</strong>
        <small>{tags.length}</small>
      </div>
      <ul className="tag-directory__list">
        {tags.map((entry) => (
          <li key={entry.key} className="tag-directory__item">
            {renaming === entry.key ? (
              <TagRenameRow
                entry={entry}
                onSave={(label) => onSaveLabel(entry.key, label)}
                onCancel={() => onRename(null)}
              />
            ) : (
              <>
                <div className="tag-directory__meta">
                  <span className="tag-directory__label">{entry.label || entry.key}</span>
                  {!entry.label && <code className="tag-directory__key">{entry.key}</code>}
                </div>
                <small className="tag-directory__counts">
                  {entry.producedBy.length} out · {entry.requiredBy.length} in
                </small>
                <button
                  className="btn btn--ghost btn--compact"
                  type="button"
                  onClick={() => onRename(entry.key)}
                >Rename</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TagRenameRow({ entry, onSave, onCancel }) {
  const [label, setLabel] = useState(entry.label ?? "");
  useEffect(() => setLabel(entry.label ?? ""), [entry.key, entry.label]);
  return (
    <div className="tag-rename">
      <code className="tag-directory__key">{entry.key}</code>
      <input
        autoFocus
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSave(label);
          if (event.key === "Escape") onCancel();
        }}
        placeholder="Human label (e.g. 粮仓已开)"
      />
      <button className="btn btn--compact" type="button" onClick={() => onSave(label)}>Save</button>
      <button className="btn btn--ghost btn--compact" type="button" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function GraphLegend({ hasHeat = false }) {
  const items = [
    ["entry", "Entry"],
    ["reachable", "Reachable"],
    ["unreachable", "Unreachable"],
    ["isolated", "Isolated"]
  ];
  return (
    <ul className="graph-legend">
      {items.map(([tone, label]) => (
        <li key={tone} className={`graph-legend__item graph-legend__item--${tone}`}>
          <span className="graph-legend__dot" />{label}
        </li>
      ))}
      {hasHeat && (
        <li className="graph-legend__item graph-legend__item--heat">
          <span className="graph-legend__dot" />Review heat
        </li>
      )}
    </ul>
  );
}

/**
 * StoryGraph renders the card-transition graph on an HTML5 canvas. Nodes are
 * laid out with a lightweight force-directed algorithm (no dependencies) and
 * re-skinned automatically by reading the active CSS variables. Pan by dragging
 * the background; click a node to open it in the Content panel.
 */
function StoryGraph({
  graph,
  cards,
  onFocusCard,
  tagCatalog,
  gaugeLabels,
  onConnect,
  onDisconnect,
  onUndo,
  historyDepth = 0,
  fullscreen = false,
  onToggleFullscreen,
  diagnostics,
  focusCardId,
  activeGroupCardIds = [],
  aiAssistEnabled = false,
  onAiGraphSelection
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const layoutRef = useRef({
    nodes: [],
    byId: new Map(),
    pan: { x: 0, y: 0 },
    zoom: 1,
    hover: null,
    connect: null
  });
  const animationRef = useRef(0);
  const [tooltip, setTooltip] = useState(null);
  const [pendingConnect, setPendingConnect] = useState(null);
  const [hoverEdge, setHoverEdge] = useState(null);
  const [disconnectButton, setDisconnectButton] = useState(null);
  const [heatVisible, setHeatVisible] = useState(true);
  const activeGroupCardSet = useMemo(() => new Set(activeGroupCardIds), [activeGroupCardIds]);

  // Map card id -> card object for quick metadata lookups (text, excerpt).
  const cardById = useMemo(() => {
    const map = new Map();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  const nodeTone = useMemo(() => {
    const map = new Map();
    if (!graph) return map;
    const isolated = new Set(graph.isolatedCards);
    const unreachable = new Set(graph.unreachableCards);
    const entry = new Set(graph.initiallyEligibleCards);
    for (const node of graph.nodes) {
      if (isolated.has(node.id)) map.set(node.id, "isolated");
      else if (unreachable.has(node.id)) map.set(node.id, "unreachable");
      else if (entry.has(node.id)) map.set(node.id, "entry");
      else map.set(node.id, "reachable");
    }
    return map;
  }, [graph]);

  const heatByCard = useMemo(() => {
    const coverage = diagnostics?.coverage ?? {};
    const cycleRates = coverage.cardCycleRates ?? {};
    const visitRates = coverage.cardVisitRates ?? {};
    const source = Object.keys(cycleRates).length > 0 ? cycleRates : visitRates;
    const map = new Map();
    let maxRate = 0;
    if (!graph || Object.keys(source).length === 0) {
      return { map, hasData: false, maxRate };
    }

    for (const node of graph.nodes) {
      const value = Number(source[node.id] ?? 0);
      const rate = Number.isFinite(value) ? Math.max(0, value) : 0;
      maxRate = Math.max(maxRate, rate);
      map.set(node.id, { rate, intensity: 0 });
    }

    const scale = maxRate || 1;
    for (const [cardId, entry] of map) {
      map.set(cardId, { ...entry, intensity: Math.min(1, entry.rate / scale) });
    }
    return { map, hasData: true, maxRate };
  }, [diagnostics, graph]);

  const colors = useSkinColors();

  function resetLayout() {
    if (!graph) return;
    const nodes = createGraphLayoutNodes(graph);
    layoutRef.current.nodes = nodes;
    layoutRef.current.byId = new Map(nodes.map((node) => [node.id, node]));
    layoutRef.current.pan = { x: 0, y: 0 };
    layoutRef.current.zoom = 1;
    layoutRef.current.hover = null;
    layoutRef.current.connect = null;
  }

  function fitToView() {
    const rect = containerRef.current?.getBoundingClientRect();
    const nodes = layoutRef.current.nodes;
    if (!rect || nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    const graphWidth = Math.max(1, maxX - minX + NODE_RADIUS * 4);
    const graphHeight = Math.max(1, maxY - minY + NODE_RADIUS * 4);
    const padding = fullscreen ? 96 : 56;
    const availableWidth = Math.max(120, rect.width - padding * 2);
    const availableHeight = Math.max(120, rect.height - padding * 2);
    const nextZoom = Math.min(2.5, Math.max(0.35, Math.min(availableWidth / graphWidth, availableHeight / graphHeight)));
    layoutRef.current.zoom = nextZoom;
    layoutRef.current.pan = {
      x: -((minX + maxX) / 2) * nextZoom,
      y: -((minY + maxY) / 2) * nextZoom
    };
  }

  function centerNode(cardId) {
    const node = layoutRef.current.byId.get(cardId);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!node || !rect) return;
    const nextZoom = Math.max(layoutRef.current.zoom, 0.8);
    layoutRef.current.zoom = nextZoom;
    layoutRef.current.pan = {
      x: -node.x * nextZoom,
      y: -node.y * nextZoom
    };
  }

  // Initialize / reset node positions when the graph identity changes.
  useEffect(() => {
    if (!graph) return;
    resetLayout();
  }, [graph]);

  useEffect(() => {
    if (!focusCardId) return;
    centerNode(focusCardId);
  }, [focusCardId, graph, fullscreen]);

  // Force simulation + render loop.
  useEffect(() => {
    if (!graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let running = true;
    let temperature = 1;

    function resize() {
      const container = canvas.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    function step() {
      if (!running) return;
      const { nodes } = layoutRef.current;
      const edgeList = graph.edges;
      const edgeSet = new Set(edgeList.map((edge) => `${edge.from}->${edge.to}`));

      // Repulsion between all node pairs.
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;
          const force = 9000 / (dist * dist);
          const fx = (dx / dist) * force * temperature;
          const fy = (dy / dist) * force * temperature;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Attraction along edges.
      for (const edge of edgeList) {
        const from = layoutRef.current.byId.get(edge.from);
        const to = layoutRef.current.byId.get(edge.to);
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 180) * 0.02 * temperature;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        from.vx += fx;
        from.vy += fy;
        to.vx -= fx;
        to.vy -= fy;
      }

      // Integrate with damping.
      for (const node of nodes) {
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x += node.vx;
        node.y += node.vy;
      }

      temperature = Math.max(temperature * 0.97, 0.02);
      render();
      if (temperature > 0.03 || hasMoving(nodes)) {
        animationRef.current = requestAnimationFrame(step);
      } else {
        animationRef.current = requestAnimationFrame(step);
      }
    }

    function hasMoving(nodes) {
      for (const node of nodes) {
        if (Math.abs(node.vx) > 0.4 || Math.abs(node.vy) > 0.4) return true;
      }
      return false;
    }

    function render() {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const zoom = layoutRef.current.zoom;
      const cx = width / 2 + layoutRef.current.pan.x;
      const cy = height / 2 + layoutRef.current.pan.y;
      const screenPoint = (node) => ({
        x: cx + node.x * zoom,
        y: cy + node.y * zoom
      });

      // Edges first so nodes render on top.
      for (const edge of graph.edges) {
        const from = layoutRef.current.byId.get(edge.from);
        const to = layoutRef.current.byId.get(edge.to);
        if (!from || !to) continue;
        const fromPoint = screenPoint(from);
        const toPoint = screenPoint(to);
        const x1 = fromPoint.x;
        const y1 = fromPoint.y;
        const x2 = toPoint.x;
        const y2 = toPoint.y;
        const fromTone = nodeTone.get(edge.from);
        const toTone = nodeTone.get(edge.to);
        const edgeTone = toTone === "unreachable" ? colors.danger : colors.muted;
        const hasGroupFilter = activeGroupCardSet.size > 0;
        const edgeInGroup = !hasGroupFilter || activeGroupCardSet.has(edge.from) || activeGroupCardSet.has(edge.to);
        ctx.strokeStyle = edgeTone;
        ctx.globalAlpha = edgeInGroup ? 0.5 : 0.12;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Arrowhead.
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 9;
        const nodeRadius = NODE_RADIUS;
        const tipX = x2 - Math.cos(angle) * (nodeRadius + 2);
        const tipY = y2 - Math.sin(angle) * (nodeRadius + 2);
        ctx.fillStyle = edgeTone;
        ctx.globalAlpha = edgeInGroup ? 1 : 0.12;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - Math.cos(angle - 0.4) * headLen,
          tipY - Math.sin(angle - 0.4) * headLen
        );
        ctx.lineTo(
          tipX - Math.cos(angle + 0.4) * headLen,
          tipY - Math.sin(angle + 0.4) * headLen
        );
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // Choice badges (L/R) at edge midpoint, with semantic tag label.
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const choiceIds = (edge.choices ?? []).map((choice) => choice.id);
        const edgeLabel = edgeSignalLabel(edge, tagCatalog?.byKey, gaugeLabels);
        const isHoverEdge = hoverEdgeRef.current?.key === `${edge.from}->${edge.to}`;
        if (isHoverEdge) {
          // Highlight the whole edge when hovered.
          ctx.strokeStyle = colors.accent2;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (edgeInGroup && choiceIds.length > 0) {
          drawChoiceBadge(ctx, midX, midY, choiceIds, colors);
        }
        if (edgeInGroup && edgeLabel) {
          drawEdgeLabel(ctx, midX, midY + 14, edgeLabel, colors);
        }
      }

      // Nodes.
      for (const node of layoutRef.current.nodes) {
        const { x, y } = screenPoint(node);
        const tone = nodeTone.get(node.id) ?? "reachable";
        const fill = toneFill(tone, colors);
        const stroke = toneStroke(tone, colors);
        const isHover = layoutRef.current.hover === node.id;
        const isFocused = focusCardId === node.id;
        const hasGroupFilter = activeGroupCardSet.size > 0;
        const nodeInGroup = !hasGroupFilter || activeGroupCardSet.has(node.id);
        const isConnectTarget = layoutRef.current.connect && layoutRef.current.hover === node.id && layoutRef.current.connect.from !== node.id;
        const heat = heatVisible && heatByCard.hasData ? heatByCard.map.get(node.id) : null;

        ctx.save();
        ctx.globalAlpha = nodeInGroup ? 1 : 0.22;
        if (nodeInGroup && heat) {
          drawNodeHeat(ctx, x, y, heat, colors);
        }
        if (nodeInGroup && isFocused) {
          drawNodeFocus(ctx, x, y, colors);
        }

        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = isFocused ? 3 : tone === "unreachable" || tone === "isolated" ? 2 : isHover ? 2.5 : 1.5;
        if (tone === "unreachable" || tone === "isolated") ctx.setLineDash([4, 3]);
        ctx.strokeStyle = isConnectTarget ? colors.accent2 : isFocused ? colors.accent2 : isHover ? colors.accent : stroke;
        ctx.stroke();
        ctx.setLineDash([]);

        // Choice handles (L/R) appear on hover; dragging from a handle starts a
        // connection to another node.
        if (isHover) {
          drawChoiceHandle(ctx, x - NODE_RADIUS, y, "L", colors);
          drawChoiceHandle(ctx, x + NODE_RADIUS, y, "R", colors);
        }

        // Label: card id, truncated.
        ctx.fillStyle = colors.ink;
        ctx.font = "600 11px var(--font-data, monospace)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = node.id.length > 14 ? `${node.id.slice(0, 13)}…` : node.id;
        ctx.fillText(label, x, y + NODE_RADIUS + 4);
        ctx.restore();
      }

      // Connection drag preview.
      if (layoutRef.current.connect) {
        const fromNode = layoutRef.current.byId.get(layoutRef.current.connect.from);
        const hoverId = layoutRef.current.hover;
        const toX = hoverId && hoverId !== layoutRef.current.connect.from
          ? screenPoint(layoutRef.current.byId.get(hoverId)).x
          : layoutRef.current.connect.toX;
        const toY = hoverId && hoverId !== layoutRef.current.connect.from
          ? screenPoint(layoutRef.current.byId.get(hoverId)).y
          : layoutRef.current.connect.toY;
        if (fromNode) {
          const fromPoint = screenPoint(fromNode);
          ctx.strokeStyle = colors.accent2;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(fromPoint.x, fromPoint.y);
          ctx.lineTo(toX, toY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      }
    }

    resize();
    step();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      running = false;
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [graph, nodeTone, colors, tagCatalog, heatByCard, heatVisible, focusCardId, activeGroupCardSet]);

  // Keep the hovered edge in a ref so the render loop reads it without re-running.
  const hoverEdgeRef = useRef(null);
  useEffect(() => { hoverEdgeRef.current = hoverEdge; }, [hoverEdge]);

  useEffect(() => {
    if (!hoverEdge) setDisconnectButton(null);
  }, [hoverEdge]);

  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [fullscreen]);

  // Pointer interaction: hover + click + pan + drag-to-connect.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    let panning = false;
    let panStart = null;

    function pointer(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function center() {
      return {
        cx: canvas.getBoundingClientRect().width / 2 + layoutRef.current.pan.x,
        cy: canvas.getBoundingClientRect().height / 2 + layoutRef.current.pan.y,
        zoom: layoutRef.current.zoom
      };
    }

    function nodeAt(point) {
      const { cx, cy, zoom } = center();
      for (const node of layoutRef.current.nodes) {
        const nx = cx + node.x * zoom;
        const ny = cy + node.y * zoom;
        const dx = point.x - nx;
        const dy = point.y - ny;
        if (dx * dx + dy * dy <= (NODE_RADIUS + 4) * (NODE_RADIUS + 4)) return node.id;
      }
      return null;
    }

    // Returns { nodeId, choiceId } if the point sits on a choice handle, else null.
    function handleAt(point) {
      const { cx, cy, zoom } = center();
      const node = layoutRef.current.byId.get(layoutRef.current.hover);
      if (!node) return null;
      const nx = cx + node.x * zoom;
      const ny = cy + node.y * zoom;
      const handles = [
        { choiceId: "left", x: nx - NODE_RADIUS, y: ny },
        { choiceId: "right", x: nx + NODE_RADIUS, y: ny }
      ];
      for (const handle of handles) {
        const dx = point.x - handle.x;
        const dy = point.y - handle.y;
        if (dx * dx + dy * dy <= 8 * 8) return { nodeId: node.id, choiceId: handle.choiceId };
      }
      return null;
    }

    function edgeMetrics(edge) {
      const { cx, cy, zoom } = center();
      const from = layoutRef.current.byId.get(edge.from);
      const to = layoutRef.current.byId.get(edge.to);
      if (!from || !to) return null;
      const fromX = cx + from.x * zoom;
      const fromY = cy + from.y * zoom;
      const toX = cx + to.x * zoom;
      const toY = cy + to.y * zoom;
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const tipX = toX - Math.cos(angle) * (NODE_RADIUS + 2);
      const tipY = toY - Math.sin(angle) * (NODE_RADIUS + 2);
      return { midX, midY, tipX, tipY };
    }

    // Returns the edge whose choice badge or arrowhead is under the pointer.
    // It only reveals the explicit delete button; clicks on the graph itself
    // never delete.
    function edgeActionAt(point) {
      for (const edge of graph.edges) {
        const metrics = edgeMetrics(edge);
        if (!metrics) continue;
        const badgeDx = point.x - metrics.midX;
        const badgeDy = point.y - metrics.midY;
        const arrowDx = point.x - metrics.tipX;
        const arrowDy = point.y - metrics.tipY;
        const overBadge = Math.abs(badgeDx) <= 34 && Math.abs(badgeDy) <= 14;
        const overArrow = arrowDx * arrowDx + arrowDy * arrowDy <= 16 * 16;
        if (overBadge || overArrow) {
          return {
            edge,
            buttonX: overBadge ? metrics.midX : metrics.tipX,
            buttonY: (overBadge ? metrics.midY : metrics.tipY) - 24
          };
        }
      }
      return null;
    }

    function onMove(event) {
      const point = pointer(event);
      const canvasRect = canvas.getBoundingClientRect();

      // Connection drag in progress: follow the cursor.
      if (layoutRef.current.connect) {
        layoutRef.current.connect.toX = point.x;
        layoutRef.current.connect.toY = point.y;
        const hoverId = nodeAt(point);
        if (hoverId !== layoutRef.current.hover) layoutRef.current.hover = hoverId;
        return;
      }

      if (panning) {
        layoutRef.current.pan.x += point.x - panStart.x;
        layoutRef.current.pan.y += point.y - panStart.y;
        panStart = point;
        return;
      }
      const id = nodeAt(point);
      if (id !== layoutRef.current.hover) {
        layoutRef.current.hover = id;
        setHoverEdge(null);
        const handle = id ? handleAt(point) : null;
        canvas.style.cursor = handle ? "crosshair" : id ? "pointer" : "grab";
        if (id) {
          const card = cardById.get(id);
          const incoming = graph.edges.filter((edge) => edge.to === id);
          const outgoing = graph.edges.filter((edge) => edge.from === id);
          if (aiAssistEnabled) {
            onAiGraphSelection?.({
              source: "graph",
              type: "story node",
              label: id,
              context: card?.text ?? `${incoming.length} incoming · ${outgoing.length} outgoing`,
              targetCardId: id,
              rect: {
                left: canvasRect.left + point.x - NODE_RADIUS,
                top: canvasRect.top + point.y - NODE_RADIUS,
                width: NODE_RADIUS * 2,
                height: NODE_RADIUS * 2
              }
            });
          }
          setTooltip({
            id,
            text: card?.text ?? "",
            tone: nodeTone.get(id),
            incoming: incoming.length,
            outgoing: outgoing.length,
            heatRate: heatByCard.hasData ? (heatByCard.map.get(id)?.rate ?? 0) : null,
            x: point.x,
            y: point.y
          });
        } else {
          setTooltip(null);
        }
      } else if (id) {
        const handle = handleAt(point);
        canvas.style.cursor = handle ? "crosshair" : "pointer";
        setTooltip((current) => (current ? { ...current, x: point.x, y: point.y } : current));
      } else {
        const action = edgeActionAt(point);
        const edgeKey = action ? `${action.edge.from}->${action.edge.to}` : null;
        if (aiAssistEnabled && action) {
          onAiGraphSelection?.({
            source: "graph",
            type: "story edge",
            label: `${action.edge.from} -> ${action.edge.to}`,
            context: edgeSignalLabel(action.edge, tagCatalog?.byKey, gaugeLabels) || "graph connection",
            targetCardId: action.edge.from,
            rect: {
              left: canvasRect.left + action.buttonX - 26,
              top: canvasRect.top + action.buttonY - 8,
              width: 52,
              height: 22
            }
          });
        }
        setHoverEdge((current) => (current?.key === edgeKey ? current : action ? { key: edgeKey, edge: action.edge } : null));
        setDisconnectButton(action ? { edge: action.edge, x: action.buttonX, y: action.buttonY } : null);
        canvas.style.cursor = action ? "default" : "grab";
      }
    }

    function onWheel(event) {
      event.preventDefault();
      const point = pointer(event);
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2 + layoutRef.current.pan.x;
      const cy = rect.height / 2 + layoutRef.current.pan.y;
      const currentZoom = layoutRef.current.zoom;
      const nextZoom = Math.min(3, Math.max(0.3, currentZoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      if (nextZoom === currentZoom) return;
      const graphX = (point.x - cx) / currentZoom;
      const graphY = (point.y - cy) / currentZoom;
      layoutRef.current.pan.x = point.x - rect.width / 2 - graphX * nextZoom;
      layoutRef.current.pan.y = point.y - rect.height / 2 - graphY * nextZoom;
      layoutRef.current.zoom = nextZoom;
    }

    function onDown(event) {
      const point = pointer(event);

      // Start a connection drag from a choice handle.
      const handle = handleAt(point);
      if (handle) {
        layoutRef.current.connect = {
          from: handle.nodeId,
          choiceId: handle.choiceId,
          toX: point.x,
          toY: point.y
        };
        setTooltip(null);
        canvas.style.cursor = "crosshair";
        return;
      }

      const id = nodeAt(point);
      if (!id) {
        if (edgeActionAt(point)) return;
        panning = true;
        panStart = point;
        canvas.style.cursor = "grabbing";
      }
    }

    function onUp(event) {
      // Finish a connection drag.
      if (layoutRef.current.connect) {
        const targetId = nodeAt(pointer(event));
        const connect = layoutRef.current.connect;
        layoutRef.current.connect = null;
        canvas.style.cursor = "grab";
        if (targetId && targetId !== connect.from) {
          setPendingConnect({
            fromCardId: connect.from,
            choiceId: connect.choiceId,
            toCardId: targetId
          });
        }
        return;
      }

      if (panning) {
        panning = false;
        canvas.style.cursor = "grab";
        panStart = null;
        return;
      }
      const point = pointer(event);
      const id = nodeAt(point);
      if (id) {
        setTooltip(null);
        onFocusCard?.(id);
        return;
      }
    }

    function onLeave(event) {
      panning = false;
      panStart = null;
      layoutRef.current.hover = null;
      layoutRef.current.connect = null;
      if (containerRef.current?.contains(event.relatedTarget)) return;
      setHoverEdge(null);
      setDisconnectButton(null);
      if (aiAssistEnabled) onAiGraphSelection?.(null);
      canvas.style.cursor = "default";
      setTooltip(null);
    }

    canvas.style.cursor = "grab";
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [graph, cardById, nodeTone, onFocusCard, onDisconnect, heatByCard, aiAssistEnabled, onAiGraphSelection, tagCatalog, gaugeLabels]);

  return (
    <div className={fullscreen ? "graph-container graph-container--fullscreen" : "graph-container"} ref={containerRef}>
      <canvas ref={canvasRef} className="graph-canvas" />
      <div className="graph-toolbar">
        <div className="graph-view-controls">
          <button
            className={`graph-icon-btn graph-heat-btn ${heatVisible && heatByCard.hasData ? "is-active" : ""}`}
            type="button"
            disabled={!heatByCard.hasData}
            title={heatByCard.hasData ? "Toggle review heat" : "Run review to show heat"}
            aria-label={heatByCard.hasData ? "Toggle review heat" : "Run review to show heat"}
            onClick={() => setHeatVisible((value) => !value)}
          >
            <HeatIcon />
          </button>
          <button
            className="graph-icon-btn graph-fit-btn"
            type="button"
            title="Fit to view"
            aria-label="Fit to view"
            onClick={fitToView}
          >
            <FitIcon />
          </button>
          <button
            className="graph-icon-btn graph-reset-btn"
            type="button"
            title="Reset layout"
            aria-label="Reset layout"
            onClick={resetLayout}
          >
            <ResetLayoutIcon />
          </button>
        </div>
        <button
          className="graph-icon-btn graph-undo"
          type="button"
          disabled={historyDepth === 0}
          title={`Undo (${historyDepth})`}
          aria-label={`Undo (${historyDepth})`}
          onClick={() => onUndo?.()}
        >
          <UndoIcon />
          <span>{historyDepth}</span>
        </button>
        <button
          className="graph-icon-btn graph-fullscreen-btn"
          type="button"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => onToggleFullscreen?.()}
        >
          {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
      </div>
      {disconnectButton && (
        <button
          className="graph-edge-delete"
          type="button"
          title="Delete connection"
          aria-label="Delete connection"
          style={{ left: disconnectButton.x, top: disconnectButton.y }}
          onMouseEnter={() => {
            const edge = disconnectButton.edge;
            setHoverEdge({ key: `${edge.from}->${edge.to}`, edge });
          }}
          onClick={() => {
            const edge = disconnectButton.edge;
            setHoverEdge(null);
            setDisconnectButton(null);
            onDisconnect?.(edge);
          }}
        >
          <DeleteXIcon />
        </button>
      )}
      {tooltip && (
        <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.id}</strong>
          {tooltip.text && <p>{tooltip.text}</p>}
          <small className={`graph-tooltip__tone graph-tooltip__tone--${tooltip.tone}`}>{tooltip.tone}</small>
          <small>{tooltip.incoming} in · {tooltip.outgoing} out</small>
          {typeof tooltip.heatRate === "number" && <small>Review cycle rate · {formatRate(tooltip.heatRate)}</small>}
          <small className="graph-tooltip__hint">Drag L/R handles to connect · click to edit</small>
        </div>
      )}
      {pendingConnect && (
        <ConnectDialog
          pending={pendingConnect}
          tagCatalog={tagCatalog}
          onCancel={() => setPendingConnect(null)}
          onConfirm={(tagKey) => {
            const request = pendingConnect;
            setPendingConnect(null);
            onConnect?.({ ...request, tagKey });
          }}
        />
      )}
    </div>
  );
}

/**
 * ConnectDialog confirms a drag-to-connect: it asks which tag should wire the
 * two cards together, defaulting to a suggested camelCase key. The creator can
 * pick an existing tag or type a new one.
 */
function ConnectDialog({ pending, tagCatalog, onCancel, onConfirm }) {
  const suggested = `${pending.fromCardId.replace(/[^a-z0-9]/gi, "")}_${pending.choiceId}`;
  const [tagKey, setTagKey] = useState(suggested);
  useEffect(() => setTagKey(suggested), [suggested]);

  return (
    <div className="connect-dialog">
      <strong>Connect cards</strong>
      <p>
        <code>{pending.fromCardId}</code> · <em>{pending.choiceId}</em> swipe
        <span className="connect-dialog__arrow">→</span>
        unlocks <code>{pending.toCardId}</code>
      </p>
      <label className="connect-dialog__label">Tag that links them</label>
      <TagPicker
        value={tagKey}
        onChange={setTagKey}
        onPick={(key) => setTagKey(key)}
        tagCatalog={tagCatalog}
        placeholder="Pick or type a tag key"
        autoFocus
      />
      <div className="connect-dialog__actions">
        <button className="btn" type="button" disabled={!tagKey.trim()} onClick={() => onConfirm(tagKey.trim())}>Connect</button>
        <button className="btn btn--ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function GraphIcon({ children }) {
  return (
    <svg className="graph-icon" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function UndoIcon() {
  return (
    <GraphIcon>
      <path d="M9 8H4V3" />
      <path d="M4 8c2-3 5-4.5 8.5-4.5A7.5 7.5 0 1 1 6 14" />
    </GraphIcon>
  );
}

function MaximizeIcon() {
  return (
    <GraphIcon>
      <path d="M8 3H3v5" />
      <path d="M16 3h5v5" />
      <path d="M21 16v5h-5" />
      <path d="M3 16v5h5" />
    </GraphIcon>
  );
}

function MinimizeIcon() {
  return (
    <GraphIcon>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M20 15h-5v5" />
      <path d="M4 15h5v5" />
    </GraphIcon>
  );
}

function HeatIcon() {
  return (
    <GraphIcon>
      <path d="M12 3v3" />
      <path d="M17.5 5.5l-2.1 2.1" />
      <path d="M21 12h-3" />
      <path d="M6 12H3" />
      <path d="M8.6 7.6 6.5 5.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M8.5 18c1.6 1 5.4 1 7 0" />
    </GraphIcon>
  );
}

function FitIcon() {
  return (
    <GraphIcon>
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M4 16v4h4" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </GraphIcon>
  );
}

function ResetLayoutIcon() {
  return (
    <GraphIcon>
      <path d="M4 7h5v5" />
      <path d="M20 17h-5v-5" />
      <path d="M8.5 15.5A5 5 0 0 0 17 12" />
      <path d="M15.5 8.5A5 5 0 0 0 7 12" />
    </GraphIcon>
  );
}

function DeleteXIcon() {
  return (
    <svg className="graph-delete-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" />
      <path d="M5 5l6 6" />
      <path d="M11 5l-6 6" />
    </svg>
  );
}

const NODE_RADIUS = 20;

function createGraphLayoutNodes(graph) {
  return graph.nodes.map((node, index) => {
    const angle = (index / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
    const radius = 160 + (graph.nodes.length > 8 ? (graph.nodes.length - 8) * 12 : 0);
    return {
      id: node.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0
    };
  });
}

/**
 * useSkinColors reads the active dashboard CSS variables once per render so the
 * canvas graph repaints with the correct palette for the active skin. The skin
 * value is read from document.documentElement.dataset.skin, matching App.
 */
function useSkinColors() {
  const [colors, setColors] = useState(() => readSkinColors());
  useEffect(() => {
    setColors(readSkinColors());
    const observer = new MutationObserver(() => setColors(readSkinColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

function readSkinColors() {
  const root = getComputedStyle(document.documentElement);
  const read = (name) => root.getPropertyValue(name).trim();
  return {
    bg: read("--bg") || "#f6f8fa",
    ink: read("--ink") || "#24292f",
    muted: read("--muted") || "#57606a",
    accent: read("--accent") || "#0969da",
    accent2: read("--accent-2") || "#8250df",
    ok: read("--ok") || "#1a7f37",
    danger: read("--danger") || "#cf222e",
    surface: read("--surface") || "#ffffff"
  };
}

function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

function drawNodeHeat(ctx, x, y, heat, colors) {
  if (heat.rate <= 0) {
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = colors.danger;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(x, y, NODE_RADIUS + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const intensity = Math.max(0.08, heat.intensity);
  ctx.save();
  ctx.globalAlpha = 0.1 + intensity * 0.28;
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 5 + intensity * 7;
  ctx.beginPath();
  ctx.arc(x, y, NODE_RADIUS + 9 + intensity * 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.32 + intensity * 0.28;
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, NODE_RADIUS + 5 + intensity * 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNodeFocus(ctx, x, y, colors) {
  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(x, y, NODE_RADIUS + 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = colors.accent2;
  ctx.beginPath();
  ctx.arc(x, y, NODE_RADIUS + 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function toneFill(tone, colors) {
  switch (tone) {
    case "entry": return colors.accent;
    case "reachable": return colors.surface;
    case "unreachable": return colors.surface;
    case "isolated": return colors.surface;
    default: return colors.surface;
  }
}

function toneStroke(tone, colors) {
  switch (tone) {
    case "entry": return colors.accent;
    case "reachable": return colors.ok;
    case "unreachable": return colors.danger;
    case "isolated": return colors.muted;
    default: return colors.muted;
  }
}

function drawChoiceBadge(ctx, x, y, choiceIds, colors) {
  const labels = choiceIds.map((choiceId) => {
    if (choiceId === "left") return "L";
    if (choiceId === "right") return "R";
    return choiceId.slice(0, 1).toUpperCase();
  });
  const text = labels.join("/");
  ctx.font = "700 9px monospace";
  const metrics = ctx.measureText(text);
  const padding = 4;
  const w = metrics.width + padding * 2;
  const h = 14;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.accent2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawEdgeLabel(ctx, x, y, text, colors) {
  ctx.font = "500 10px var(--font-data, monospace)";
  const metrics = ctx.measureText(text);
  const padding = 5;
  const w = metrics.width + padding * 2;
  const h = 14;
  ctx.fillStyle = colors.bg;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 3);
  } else {
    ctx.rect(x - w / 2, y - h / 2, w, h);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawChoiceHandle(ctx, x, y, label, colors) {
  const r = 7;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colors.surface;
  ctx.fill();
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = colors.accent2;
  ctx.font = "700 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}

function ReviewPanel({ editor, diagnostics, aiAssistEnabled, onRun, onOpen, onFocusCard, onAiAction, activeAiAction }) {
  const [cycles, setCycles] = useState(500);
  const [maxTurns, setMaxTurns] = useState(40);
  const [seed, setSeed] = useState(1);
  const [view, setView] = useState("overview");
  const cards = editor?.cards ?? [];
  const cardMap = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const gaugeLabels = useMemo(() => createGaugeLabels(editor?.metadata?.presentation), [editor?.metadata?.presentation]);
  const coverageRows = useMemo(() => buildReviewCoverageRows(cards, diagnostics), [cards, diagnostics]);
  const issueCards = useMemo(() => buildReviewIssues(diagnostics), [diagnostics]);

  function aiRepairForIssue(issue) {
    onAiAction({
      source: "Review",
      actionId: `issue-${issue.code}`,
      actionLabel: `Repair ${issue.code}`,
      mode: "repair_diagnostics",
      cardCount: 1,
      contextSummary: `${issue.severity} · ${issue.code}`,
      instruction: `Use the latest Review diagnostics to repair '${issue.code}'. Focus on: ${issue.message}. Targets: ${issue.cardIds.length > 0 ? issue.cardIds.join(", ") : "project-level issue"}. Keep changes as explicit patch proposals.`
    });
  }

  return (
    <section className="panel">
      <PanelHead title="Review Diagnostics" note="Creator-facing Monte Carlo review with reproducible seed inputs." />
      <div className="field-row field-row--compact review-run-row">
        <label>Cycles <input type="number" min="1" value={cycles} onChange={(event) => setCycles(Number(event.target.value))} /></label>
        <label>Max turns <input type="number" min="1" value={maxTurns} onChange={(event) => setMaxTurns(Number(event.target.value))} /></label>
        <label>Seed <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        <button className="btn btn--primary" onClick={() => void onRun({ cycles, maxTurns, seed })}>Run review</button>
      </div>
      {diagnostics ? (
        <>
          <ReviewSummary diagnostics={diagnostics} gaugeLabels={gaugeLabels} />
          <div className="review-tabs" role="tablist" aria-label="Review views">
            {[
              ["overview", "Overview"],
              ["coverage", "Coverage"],
              ["story", "Story"],
              ["issues", `Issues ${issueCards.length}`]
            ].map(([id, label]) => (
              <button
                key={id}
                className={view === id ? "review-tabs__item review-tabs__item--active" : "review-tabs__item"}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "overview" && (
            <ReviewOverview diagnostics={diagnostics} gaugeLabels={gaugeLabels} coverageRows={coverageRows} issueCards={issueCards} onOpenStory={() => onOpen("story")} />
          )}
          {view === "coverage" && (
            <ReviewCoverage rows={coverageRows} onFocusCard={onFocusCard} />
          )}
          {view === "story" && (
            <NarrativeCoverage narrative={diagnostics.narrative} onOpenStory={() => onOpen("story")} onFocusCard={onFocusCard} />
          )}
          {view === "issues" && (
            <ReviewIssues
              issues={issueCards}
              cardMap={cardMap}
              onFocusCard={onFocusCard}
              onOpenStory={() => onOpen("story")}
              onAiRepair={aiRepairForIssue}
            />
          )}
        </>
      ) : (
        <div className="empty-state">
          <p>No review has been run in this session.</p>
        </div>
      )}
    </section>
  );
}

function ReviewSummary({ diagnostics, gaugeLabels }) {
  const coverage = diagnostics.coverage ?? {};
  const warningCounts = diagnostics.warningCounts ?? {};
  return (
    <section className="review-summary" aria-label="Review summary">
      <div className="review-score">
        <strong>{diagnostics.healthScore}/100</strong>
        <span>{diagnostics.headline}</span>
      </div>
      <div className="review-summary__metrics">
        <Metric label="Cycles" value={String(diagnostics.sampleSize ?? 0)} />
        <Metric label="Avg turns" value={String(coverage.averageTurns ?? 0)} />
        <Metric label="Game over" value={formatRate(coverage.gameOverRate ?? 0)} tone={(coverage.gameOverRate ?? 0) > 0.8 ? "bad" : ""} />
        <Metric label="Stalled" value={formatRate(coverage.stalledRate ?? 0)} tone={(coverage.stalledRate ?? 0) > 0 ? "bad" : ""} />
        <Metric label="Errors" value={String(warningCounts.error ?? 0)} tone={(warningCounts.error ?? 0) > 0 ? "bad" : "good"} />
        <Metric label="Warnings" value={String(warningCounts.warning ?? 0)} tone={(warningCounts.warning ?? 0) > 0 ? "bad" : ""} />
      </div>
      <div className="review-gauge-strip" aria-label="Gauge pressure">
        {(diagnostics.factions ?? []).map((entry) => (
          <div className="review-gauge" key={entry.faction}>
            <div>
              <strong>{gaugeDisplayName(entry.faction, gaugeLabels)}</strong>
              <span>avg {entry.average} · end {formatRate(entry.gameOverShare ?? 0)}</span>
            </div>
            <div className="review-gauge__bar"><span style={{ width: `${Math.max(2, Math.round((entry.gameOverShare ?? 0) * 100))}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewOverview({ diagnostics, gaugeLabels, coverageRows, issueCards, onOpenStory }) {
  const worstCoverage = coverageRows.filter((row) => row.status !== "covered").slice(0, 5);
  return (
    <div className="review-overview">
      <div className="review-panel-block">
        <div className="review-panel-block__head">
          <strong>Top risks</strong>
          <span>{issueCards.length} issue{issueCards.length === 1 ? "" : "s"}</span>
        </div>
        {issueCards.length > 0 ? (
          <div className="review-risk-list">
            {issueCards.slice(0, 4).map((issue) => (
              <div className={`review-risk review-risk--${issue.severity}`} key={issue.id}>
                <code>{issue.code}</code>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No review issues.</p>
        )}
      </div>
      <div className="review-panel-block">
        <div className="review-panel-block__head">
          <strong>Weak coverage</strong>
          <span>{worstCoverage.length} cards</span>
        </div>
        {worstCoverage.length > 0 ? (
          <div className="review-risk-list">
            {worstCoverage.map((row) => (
              <div className={`review-risk review-risk--${row.tone}`} key={row.cardId}>
                <code>{row.cardId}</code>
                <span>{row.status} · visit {formatRate(row.visitRate)} · cycle {formatRate(row.cycleRate)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">All reviewed cards were visited.</p>
        )}
      </div>
      <div className="review-panel-block">
        <div className="review-panel-block__head">
          <strong>Ending coverage</strong>
          <button className="btn btn--ghost btn--compact" type="button" onClick={onOpenStory}>Story</button>
        </div>
        <div className="review-ending-summary">
          <Metric label="Endings" value={`${diagnostics.narrative?.summary?.coveredEndingGroupCount ?? 0}/${diagnostics.narrative?.summary?.endingGroupCount ?? 0}`} />
          <Metric label="Story groups" value={`${diagnostics.narrative?.summary?.coveredGroupCount ?? 0}/${diagnostics.narrative?.summary?.groupCount ?? 0}`} />
          <Metric label="Story issues" value={String(diagnostics.narrative?.summary?.issueCount ?? 0)} tone={(diagnostics.narrative?.summary?.issueCount ?? 0) > 0 ? "bad" : "good"} />
        </div>
      </div>
      <div className="review-panel-block">
        <div className="review-panel-block__head">
          <strong>Gauge pressure</strong>
          <span>{diagnostics.factions?.length ?? 0} gauges</span>
        </div>
        <div className="review-risk-list">
          {(diagnostics.factions ?? []).map((entry) => (
            <div className="review-risk" key={entry.faction}>
              <code>{gaugeDisplayName(entry.faction, gaugeLabels)}</code>
              <span>average {entry.average}; game-over share {formatRate(entry.gameOverShare ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewCoverage({ rows, onFocusCard }) {
  return (
    <section className="review-coverage" aria-label="Card coverage">
      {rows.map((row) => (
        <article
          className={`review-card-row review-card-row--${row.tone}`}
          key={row.cardId}
          data-ai-target="review coverage"
          data-ai-label={row.cardId}
          data-ai-context={`${row.status} · visit ${formatRate(row.visitRate)} · cycle ${formatRate(row.cycleRate)}`}
          data-ai-card-id={row.cardId}
        >
          <div className="review-card-row__head">
            <button className="btn btn--ghost btn--compact" type="button" onClick={() => onFocusCard(row.cardId)}>{row.cardId}</button>
            <span>{row.status}</span>
          </div>
          <p>{row.excerpt}</p>
          <div className="review-card-row__bars">
            <ReviewRateBar label="Visit" rate={row.visitRate} />
            <ReviewRateBar label="Cycle" rate={row.cycleRate} />
          </div>
          <div className="review-targets">
            {row.unvisited && <span className="review-chip review-chip--bad">unvisited</span>}
            {row.lowCycle && <span className="review-chip review-chip--warn">low cycle {formatRate(row.lowCycleRate)}</span>}
          </div>
        </article>
      ))}
      {rows.length === 0 && <p className="muted">Run Review to inspect card coverage.</p>}
    </section>
  );
}

function ReviewRateBar({ label, rate }) {
  return (
    <div className="review-rate">
      <div>
        <span>{label}</span>
        <strong>{formatRate(rate)}</strong>
      </div>
      <div className="review-rate__track"><span style={{ width: `${Math.max(2, Math.round(rate * 100))}%` }} /></div>
    </div>
  );
}

function ReviewIssues({ issues, cardMap, onFocusCard, onOpenStory, onAiRepair }) {
  return (
    <section className="review-issues" aria-label="Review issues">
      {issues.length > 0 ? issues.map((issue) => (
        <article
          className={`review-issue review-issue--${issue.severity}`}
          key={issue.id}
          data-ai-target="review issue"
          data-ai-label={issue.code}
          data-ai-context={issue.message}
          data-ai-card-id={issue.cardIds[0] ?? ""}
        >
          <div className="review-issue__head">
            <div>
              <code>{issue.code}</code>
              <strong>{issue.message}</strong>
            </div>
            <span>{issue.severity}</span>
          </div>
          <div className="review-targets">
            {issue.cardIds.map((cardId) => (
              <button className="review-chip review-chip--button" type="button" key={cardId} title={cardExcerpt(cardMap.get(cardId) ?? { id: cardId })} onClick={() => onFocusCard(cardId)}>
                {cardId}
              </button>
            ))}
            {issue.otherTargets.map((target) => <span className="review-chip" key={target}>{target}</span>)}
            {issue.cardIds.length === 0 && issue.otherTargets.length === 0 && <span className="review-chip">project</span>}
          </div>
          <div className="action-row">
            {issue.cardIds[0] && <button className="btn btn--ghost btn--compact" type="button" onClick={() => onFocusCard(issue.cardIds[0])}>Focus card</button>}
            <button className="btn btn--ghost btn--compact" type="button" onClick={onOpenStory}>Story</button>
            <button className="btn btn--primary btn--compact" type="button" onClick={() => onAiRepair(issue)}>AI Repair</button>
          </div>
        </article>
      )) : (
        <div className="empty-state"><p>No diagnostics warnings.</p></div>
      )}
    </section>
  );
}

function NarrativeCoverage({ narrative, onOpenStory, onFocusCard }) {
  const groups = narrative?.storyGroups ?? [];
  const summary = narrative?.summary ?? {};

  return (
    <section className="narrative-review" aria-label="Narrative coverage">
      <div className="narrative-review__head">
        <div>
          <strong>Narrative coverage</strong>
          <span>{groups.length > 0 ? `${summary.issueCount ?? 0} story issue${summary.issueCount === 1 ? "" : "s"}` : "No story groups configured"}</span>
        </div>
        <button className="btn btn--ghost btn--compact" type="button" onClick={onOpenStory}>Story graph</button>
      </div>

      {groups.length > 0 ? (
        <>
          <div className="narrative-review__metrics" aria-label="Story coverage summary">
            <div>
              <span>Groups</span>
              <strong>{summary.coveredGroupCount ?? 0}/{summary.groupCount ?? 0}</strong>
            </div>
            <div>
              <span>Unvisited</span>
              <strong>{summary.unvisitedGroupCount ?? 0}</strong>
            </div>
            <div>
              <span>Endings</span>
              <strong>{summary.coveredEndingGroupCount ?? 0}/{summary.endingGroupCount ?? 0}</strong>
            </div>
          </div>
          <ul className="narrative-review__list">
            {groups.map((group) => (
              <li key={group.id} className={`narrative-review__item narrative-review__item--${group.tone}`}>
                <div className="narrative-review__item-head">
                  <div>
                    <strong>{group.label}</strong>
                    <span>{group.type} · {group.cardCount} card{group.cardCount === 1 ? "" : "s"}</span>
                  </div>
                  <code>{group.status}</code>
                </div>
                <div className="narrative-review__bar" aria-label={`${group.label} coverage ${formatRate(group.coverageRate)}`}>
                  <span style={{ width: `${Math.round(group.coverageRate * 100)}%` }} />
                </div>
                <div className="narrative-review__facts">
                  <span>{formatRate(group.coverageRate)} cards reached</span>
                  <span>{formatRate(group.averageCycleRate)} avg cycle rate</span>
                  {group.unvisitedCardIds.length > 0 && <span>{group.unvisitedCardIds.length} unvisited</span>}
                  {group.unreachableCardIds.length > 0 && <span>{group.unreachableCardIds.length} unreachable</span>}
                </div>
                {(group.unvisitedCardIds.length > 0 || group.unreachableCardIds.length > 0 || group.lowCycleCards.length > 0) && (
                  <div className="review-targets">
                    {group.unreachableCardIds.map((cardId) => (
                      <button className="review-chip review-chip--bad review-chip--button" type="button" key={`unreachable-${cardId}`} onClick={() => onFocusCard?.(cardId)}>
                        {cardId}
                      </button>
                    ))}
                    {group.unvisitedCardIds.filter((cardId) => !group.unreachableCardIds.includes(cardId)).map((cardId) => (
                      <button className="review-chip review-chip--warn review-chip--button" type="button" key={`unvisited-${cardId}`} onClick={() => onFocusCard?.(cardId)}>
                        {cardId}
                      </button>
                    ))}
                    {group.lowCycleCards.map((entry) => (
                      <button className="review-chip review-chip--warn review-chip--button" type="button" key={`low-${entry.cardId}`} onClick={() => onFocusCard?.(entry.cardId)}>
                        {entry.cardId} {formatRate(entry.rate)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">Define chapters, themes, arcs, or endings in metadata.story.groups to review narrative coverage.</p>
      )}
    </section>
  );
}

function buildReviewCoverageRows(cards, diagnostics) {
  if (!diagnostics) return [];
  const coverage = diagnostics.coverage ?? {};
  const visitRates = coverage.cardVisitRates ?? {};
  const cycleRates = coverage.cardCycleRates ?? {};
  const unvisitedSet = new Set(coverage.unvisitedCards ?? []);
  const lowCycleMap = new Map((coverage.lowCycleCards ?? []).map((entry) => [entry.cardId, entry.rate ?? 0]));

  return cards.map((card) => {
    const visitRate = visitRates[card.id] ?? 0;
    const cycleRate = cycleRates[card.id] ?? 0;
    const unvisited = unvisitedSet.has(card.id) || visitRate <= 0;
    const lowCycle = lowCycleMap.has(card.id);
    const status = unvisited ? "unvisited" : lowCycle ? "low cycle" : "covered";
    return {
      cardId: card.id,
      excerpt: cardExcerpt(card),
      visitRate,
      cycleRate,
      lowCycleRate: lowCycleMap.get(card.id) ?? 0,
      unvisited,
      lowCycle,
      status,
      tone: unvisited ? "bad" : lowCycle ? "warn" : "good"
    };
  }).sort((a, b) => reviewCoverageRank(a) - reviewCoverageRank(b) || a.cardId.localeCompare(b.cardId));
}

function reviewCoverageRank(row) {
  if (row.unvisited) return 0;
  if (row.lowCycle) return 1;
  return 2;
}

function buildReviewIssues(diagnostics) {
  if (!diagnostics) return [];
  const warningIssues = (diagnostics.warnings ?? []).map((warning, index) => {
    const targets = extractReviewTargets(warning.details ?? {});
    return {
      id: `warning-${warning.code}-${index}`,
      code: warning.code,
      severity: warning.severity ?? "warning",
      message: warning.message ?? "Review warning.",
      cardIds: targets.cardIds,
      otherTargets: targets.otherTargets
    };
  });
  const narrativeIssues = (diagnostics.narrative?.issues ?? []).map((issue, index) => ({
    id: `story-${issue.code}-${index}`,
    code: issue.code,
    severity: issue.severity ?? "warning",
    message: issue.message ?? "Story coverage issue.",
    cardIds: normalizeStringArray(issue.cardIds),
    otherTargets: [issue.groupId].filter(Boolean)
  }));
  const seen = new Set();
  return [...warningIssues, ...narrativeIssues].filter((issue) => {
    const key = `${issue.code}:${issue.cardIds.join(",")}:${issue.otherTargets.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractReviewTargets(details = {}) {
  const cardIds = new Set(normalizeStringArray(details.cardIds));
  for (const entry of Array.isArray(details.cards) ? details.cards : []) {
    if (typeof entry?.cardId === "string") cardIds.add(entry.cardId);
  }
  const otherTargets = [
    ...normalizeStringArray(details.tags).map((tag) => `tag:${tag}`),
    ...normalizeStringArray(details.variables).map((variable) => `var:${variable}`),
    ...normalizeStringArray(details.factions).map((faction) => `gauge:${faction}`),
    typeof details.faction === "string" ? `gauge:${details.faction}` : null
  ].filter(Boolean);
  return { cardIds: [...cardIds], otherTargets };
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()) : [];
}

function PreviewPanel({ play, assetsByCard, playerReady, onStart, onSwipe }) {
  const state = play.state;
  const card = state?.currentCard;
  const asset = card ? assetsByCard.get(card.id) : null;
  const left = card?.choices?.find((choice) => choice.id === "left");
  const right = card?.choices?.find((choice) => choice.id === "right");

  return (
    <section className="panel">
      <PanelHead title="Developer Preview" note="Debuggable preview over the same headless runtime used by player builds." />
      <div className="preview-layout">
        <div className="gauge-stack">
          {Object.entries(state?.gauges ?? {}).map(([name, gauge]) => (
            <div className="gauge" key={name}>
              <span>{gauge.label || name} · {gauge.value}</span>
              {gauge.description && <small>{gauge.description}</small>}
              <div><b style={{ width: `${gauge.left}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="play-card">
          {asset && <img src={`/${asset.uri}`} alt="" />}
          <p>{card?.text ?? (state?.gameOver ? "The reign has ended." : "No preview session.")}</p>
          <div className="choice-buttons">
            <button className="btn btn--choice" disabled={!card} onClick={() => void onSwipe("left")}>← {left?.label ?? "Left"}</button>
            <button className="btn btn--choice" disabled={!card} onClick={() => void onSwipe("right")}>{right?.label ?? "Right"} →</button>
          </div>
        </div>
      </div>
      <div className="action-row">
        <button className="btn btn--primary" disabled={!playerReady} onClick={() => void onStart()}>Start preview</button>
        <span className="muted">Keyboard: Arrow keys or A/D. Session: {play.sessionId ?? "none"}</span>
      </div>
    </section>
  );
}

function BuildPanel({ build, onPrepare }) {
  return (
    <section className="panel">
      <PanelHead title="Build / Deploy" note="Prepare and export the deployable player bundle." />
      <div className="action-row">
        <button className="btn" onClick={() => void onPrepare(false)}>Preview build</button>
        <button className="btn btn--primary" onClick={() => void onPrepare(true)}>{import.meta.env.VITE_CREATOR_HOST === "browser" ? "Export player ZIP" : "Export .game.json"}</button>
      </div>
      <pre className="output">{build ? JSON.stringify(build.build ?? build, null, 2) : "No build prepared."}</pre>
    </section>
  );
}

function AiAssistPreflight({ request, aiConfigured, diagnostics, onChange, onClose, onBuild, onOpenPanel }) {
  const needsDiagnostics = request.mode === "repair_diagnostics";
  const canBuild = !needsDiagnostics || Boolean(diagnostics);
  const modeLabel = AI_MODE_LABELS[request.mode] ?? request.mode;

  return (
    <div className="ai-preflight" role="dialog" aria-modal="false" aria-label="AI Assist preflight">
      <div className="ai-preflight__panel">
        <div className="ai-preflight__head">
          <div>
            <span>{request.source}</span>
            <h3>{request.actionLabel}</h3>
          </div>
          <button className="btn btn--ghost btn--compact" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="ai-preflight__summary">
          <Metric label="Mode" value={modeLabel} />
          <Metric label="Target" value={request.targetCardId || request.assetId || "Project"} />
          <Metric label="Output" value={`${request.cardCount ?? 1} item${(request.cardCount ?? 1) === 1 ? "" : "s"}`} />
          <Metric label="Endpoint" value={aiConfigured ? "Configured" : "Local"} />
        </div>
        <label className="ai-preflight__field">
          Context
          <input value={request.contextSummary ?? ""} onChange={(event) => onChange({ contextSummary: event.target.value })} />
        </label>
        <div className="field-row field-row--compact">
          <select value={request.mode} onChange={(event) => onChange({ mode: event.target.value })}>
            {Object.entries(AI_MODE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <input
            type="number"
            min="1"
            max="12"
            value={request.cardCount ?? 1}
            onChange={(event) => onChange({ cardCount: Number(event.target.value) })}
            aria-label="Expected output count"
          />
        </div>
        <label className="ai-preflight__field">
          Prompt
          <textarea
            value={request.instruction ?? ""}
            onChange={(event) => onChange({ instruction: event.target.value })}
            rows={5}
          />
        </label>
        {needsDiagnostics && !diagnostics && (
          <p className="ai-preflight__warning">Run Review before building repair proposals.</p>
        )}
        <div className="action-row">
          <button className="btn btn--primary" type="button" disabled={!canBuild || !request.instruction?.trim()} onClick={onBuild}>
            Build draft
          </button>
          <button className="btn" type="button" onClick={onOpenPanel}>Open full panel</button>
          <button className="btn btn--ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AiAssistPanel({ editor, diagnostics, aiSettings, apiKeyAvailable, aiAssistEnabled, aiConfigured, draftRequest, onBuildPlan, onApplyPlan, onOpen }) {
  const [mode, setMode] = useState("generate_cards");
  const [theme, setTheme] = useState(editor?.metadata?.title ?? "small court");
  const [style, setStyle] = useState("ink wash card art");
  const [cardCount, setCardCount] = useState(2);
  const [targetCardId, setTargetCardId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState([]);
  const [applyResult, setApplyResult] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [progressStep, setProgressStep] = useState(-1);
  const [progressStatus, setProgressStatus] = useState("idle");
  const [buildError, setBuildError] = useState("");
  const promptRef = useRef(null);
  const autoBuildRef = useRef(null);
  const cards = editor?.cards ?? [];
  const assets = editor?.assets ?? [];
  const requiresDiagnostics = mode === "repair_diagnostics";
  const canBuild = !requiresDiagnostics || Boolean(diagnostics);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!targetCardId && cards[0]?.id) {
      setTargetCardId(cards[0].id);
    }
  }, [cards, targetCardId]);

  useEffect(() => {
    setPlan(null);
    setSelected([]);
    setApplyResult("");
  }, [mode]);

  useEffect(() => {
    if (!draftRequest) return;
    setMode(draftRequest.mode ?? "generate_cards");
    setInstruction(draftRequest.instruction ?? "");
    setTargetCardId(draftRequest.targetCardId ?? "");
    setAssetId(draftRequest.assetId ?? "");
    if (draftRequest.cardCount) setCardCount(draftRequest.cardCount);
    if (draftRequest.theme) setTheme(draftRequest.theme);
    setPlan(null);
    setSelected([]);
    setApplyResult("");
    setBuildError("");
    setProgressStep(-1);
    setProgressStatus("idle");
    if (draftRequest.autoBuild && autoBuildRef.current !== draftRequest.id) {
      autoBuildRef.current = draftRequest.id;
      void buildPlan(draftRequest);
    }
  }, [draftRequest?.id]);

  async function buildPlan(overrides = null) {
    const nextMode = overrides?.mode ?? mode;
    const nextInstruction = overrides?.instruction ?? instruction;
    const nextTargetCardId = overrides?.targetCardId ?? targetCardId;
    const nextAssetId = overrides?.assetId ?? assetId;
    const nextCardCount = overrides?.cardCount ?? cardCount;
    const nextTheme = overrides?.theme ?? theme;
    const nextStyle = overrides?.style ?? style;
    const nextRequiresDiagnostics = nextMode === "repair_diagnostics";
    if (isBuilding) return;
    if (nextRequiresDiagnostics && !diagnostics) {
      setProgressStep(0);
      setProgressStatus("failed");
      setBuildError("Review repair needs a completed Review result before AI Assist can build repair proposals.");
      return;
    }
    if (!nextInstruction?.trim()) {
      setProgressStep(0);
      setProgressStatus("failed");
      setBuildError("Add a prompt before building the draft.");
      return;
    }
    setIsBuilding(true);
    setBuildError("");
    setProgressStatus("building");
    setProgressStep(0);
    await wait(110);
    setProgressStep(1);
    await wait(90);
    setProgressStep(2);
    const result = await onBuildPlan({
      mode: nextMode,
      config: buildAiConnectorConfig(
        aiSettings,
        { theme: nextTheme, cardCount: nextCardCount, style: nextStyle },
        { hasApiKey: apiKeyAvailable }
      ),
      instruction: nextInstruction,
      targetCardId: nextTargetCardId || null,
      assetId: nextAssetId || null,
      diagnostics: nextRequiresDiagnostics ? diagnostics : null
    });
    if (!result || result === true) {
      setProgressStatus("failed");
      setBuildError("AI Assist draft failed. Check the status bar, edit the prompt, or retry.");
      setIsBuilding(false);
      return;
    }
    await wait(90);
    setProgressStep(3);
    await wait(90);
    setProgressStep(4);
    await wait(90);
    if (result && result !== true) {
      setPlan(result);
      setSelected((result.proposals ?? []).filter((proposal) => (proposal.patches ?? []).length > 0).map((proposal) => proposal.id));
      setApplyResult("");
      setProgressStep(5);
      setProgressStatus("ready");
    }
    setIsBuilding(false);
  }

  async function retryBuild() {
    await buildPlan();
  }

  function focusPrompt() {
    promptRef.current?.focus();
  }

  async function applySelected() {
    if (!plan || selected.length === 0) return;
    const result = await onApplyPlan(plan, selected);
    if (result) {
      setApplyResult(`Applied ${selected.length} proposal${selected.length === 1 ? "" : "s"}.`);
      setPlan(null);
      setSelected([]);
    }
  }

  function toggleProposal(proposalId) {
    setSelected((current) =>
      current.includes(proposalId)
        ? current.filter((id) => id !== proposalId)
        : [...current, proposalId]
    );
  }

  return (
    <section className="panel">
      <PanelHead title="AI Assist" note="Contextual draft planning, review repair, and visual request previews." />
      <div className={`ai-endpoint-card ${aiConfigured ? "ai-endpoint-card--ready" : "ai-endpoint-card--setup"}`}>
        <div>
          <span>{aiAssistEnabled ? "Assist layer visible" : "Assist layer hidden"}</span>
          <strong>{aiConfigured ? aiSettings.modelId : "Local draft planner"}</strong>
          <small>
            {aiConfigured
              ? `${aiSettings.protocol} · ${aiSettings.baseUrl}`
              : "No endpoint configured. Local draft planning remains available."}
          </small>
        </div>
        <button className="btn btn--ghost btn--compact" type="button" onClick={() => onOpen("settings")}>Settings</button>
      </div>
      {draftRequest?.actionLabel && (
        <div className="ai-request-source">
          <span>{draftRequest.source ?? "Contextual action"}</span>
          <strong>{draftRequest.actionLabel}</strong>
          <small>{draftRequest.contextSummary ?? "Current project context"}</small>
        </div>
      )}
      <div className="ai-edit-layout">
        <div className="subsection ai-edit-controls">
          <h3>Request</h3>
          <div className="field-row field-row--compact">
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="generate_cards">Draft cards</option>
              <option value="repair_diagnostics">Repair review</option>
              <option value="generate_asset">Generate visual request</option>
              <option value="analyze_asset">Analyze visual request</option>
            </select>
            <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="theme" />
            <input type="number" min="1" max="12" value={cardCount} onChange={(event) => setCardCount(Number(event.target.value))} />
          </div>
          <div className="field-row field-row--compact">
            <select value={targetCardId} onChange={(event) => setTargetCardId(event.target.value)}>
              <option value="">No target card</option>
              {cards.map((card) => <option key={card.id} value={card.id}>{card.id}</option>)}
            </select>
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
              <option value="">No target asset</option>
              {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}
            </select>
            <input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="visual style" />
          </div>
          <textarea
            ref={promptRef}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Describe what the AI should draft, repair, generate, or inspect."
            rows={5}
          />
          <AiProgress step={progressStep} active={isBuilding} status={progressStatus} />
          {buildError && (
            <div className="ai-build-error" role="alert">
              <div>
                <strong>Draft failed</strong>
                <span>{buildError}</span>
              </div>
              <div className="ai-build-error__actions">
                <button className="btn btn--ghost btn--compact" type="button" disabled={isBuilding} onClick={() => void retryBuild()}>Retry</button>
                <button className="btn btn--ghost btn--compact" type="button" onClick={focusPrompt}>Edit prompt</button>
              </div>
            </div>
          )}
          <div className="action-row">
            <button className="btn btn--primary" disabled={!canBuild || isBuilding} onClick={() => void buildPlan()}>
              {isBuilding ? "Building draft..." : "Build draft"}
            </button>
            <button className="btn" onClick={() => onOpen("content")}>Content</button>
            <button className="btn" onClick={() => onOpen("review")}>Review</button>
          </div>
          {requiresDiagnostics && !diagnostics && (
            <p className="muted">Repair proposals use the latest Review result. Run Review first, then return here.</p>
          )}
        </div>

        <div className="subsection">
          <h3>Context</h3>
          <div className="ai-context-grid">
            <Metric label="Cards" value={String(cards.length)} />
            <Metric label="Assets" value={String(assets.length)} />
            <Metric label="Review" value={diagnostics ? `${diagnostics.healthScore}/100` : "Not run"} tone={diagnostics ? "" : "bad"} />
            <Metric label="Endpoint" value={aiConfigured ? aiSettings.protocol : "Local"} />
            <Metric label="Target" value={targetCardId || "None"} />
          </div>
          <pre className="output output--compact">
            {plan ? JSON.stringify(plan.request.context, null, 2) : "Build a plan to preview the AI context."}
          </pre>
        </div>
      </div>

      <div className="subsection">
        <h3>Proposals</h3>
        {plan ? (
          <>
            <div className="action-row">
              <button className="btn" onClick={() => setSelected((plan.proposals ?? []).map((proposal) => proposal.id))}>Select all</button>
              <button className="btn" onClick={() => setSelected([])}>Clear</button>
              <button className="btn btn--primary" disabled={selected.length === 0} onClick={() => void applySelected()}>Apply selected</button>
              <span className="muted">{selected.length}/{plan.proposals?.length ?? 0} selected</span>
            </div>
            <div className="ai-proposal-list">
              {(plan.proposals ?? []).map((proposal) => (
                <article className="ai-proposal" key={proposal.id}>
                  <label className="ai-proposal__head">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(proposal.id)}
                      onChange={() => toggleProposal(proposal.id)}
                      disabled={(proposal.patches ?? []).length === 0}
                    />
                    <span>
                      <strong>{proposal.title}</strong>
                      <small>{proposal.source?.mode ?? plan.mode} · {(proposal.target?.cardIds ?? []).join(", ") || "context"}</small>
                    </span>
                  </label>
                  <p>{proposal.summary}</p>
                  <pre className="output output--compact">{JSON.stringify(proposal.patches, null, 2)}</pre>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">No AI Assist draft yet.</p>
        )}
        {applyResult && <p className="muted">{applyResult}</p>}
      </div>
    </section>
  );
}

async function downloadJsonZip(entries, fileName) {
  const { strToU8, zipSync } = await import("fflate");
  const files = Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(`${JSON.stringify(value, null, 2)}\n`)]));
  const url = URL.createObjectURL(new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }));
  try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); }
  finally { URL.revokeObjectURL(url); }
}

async function readJsonFile(file, preferredEntries = []) {
  if (!file.name.toLowerCase().endsWith(".zip")) return JSON.parse(await file.text());
  const { strFromU8, unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const name = preferredEntries.find((entry) => entries[entry]) ?? Object.keys(entries).find((entry) => entry.endsWith(".json"));
  if (!name) throw new Error("ZIP does not contain a JSON project or workspace document");
  return JSON.parse(strFromU8(entries[name]));
}

function HostedWorkspaceTools({ onRefresh, onStatus }) {
  const [storage, setStorage] = useState(null);
  const [includeApiKey, setIncludeApiKey] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { void api("/api/workspace/storage").then(setStorage).catch(() => {}); }, []);

  async function persist() {
    const result = await api("/api/workspace/persist", { method: "POST", body: {} });
    setStorage(result);
    onStatus(result.persisted ? "Browser storage is persistent" : "Persistent storage was not granted; keep backups");
  }
  async function exportWorkspace() {
    if (includeApiKey && !window.confirm("This backup will contain your API key in plaintext. Continue?")) return;
    const snapshot = await api("/api/workspace/export", { method: "POST", body: { includeApiKey } });
    await downloadJsonZip({ "workspace.json": snapshot }, `ReignsAgent-workspace-${new Date().toISOString().slice(0, 10)}.zip`);
  }
  async function exportProject() {
    const snapshot = await api("/api/editor/snapshot");
    await downloadJsonZip({ "content.json": snapshot.bundle }, `ReignsAgent-project-${new Date().toISOString().slice(0, 10)}.zip`);
  }
  async function importWorkspace(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { const snapshot = await readJsonFile(file, ["workspace.json"]); await api("/api/workspace/import", { method: "POST", body: { snapshot, replace: false } }); window.location.reload(); }
    finally { event.target.value = ""; }
  }
  const usage = storage?.usage != null && storage?.quota ? `${Math.round(storage.usage / 1048576)} MB of ${Math.round(storage.quota / 1048576)} MB` : "Capacity unavailable";
  return (
    <div className="subsection hosted-workspace-tools">
      <h3>Browser workspace</h3>
      <p className="muted">Projects live in this site's private storage. Clearing site data deletes them, so keep regular backups.</p>
      <div className="action-row">
        <span className={`endpoint-check endpoint-check--${storage?.persisted ? "ok" : "idle"}`}>{storage?.persisted ? "Persistent storage granted" : "Storage may be reclaimed"} · {usage}</span>
        {!storage?.persisted && <button className="btn" type="button" onClick={() => void persist()}>Request persistence</button>}
      </div>
      <div className="action-row">
        <label><input type="checkbox" checked={includeApiKey} onChange={(event) => setIncludeApiKey(event.target.checked)} /> Include plaintext API key</label>
        <button className="btn" type="button" onClick={() => void exportWorkspace()}>Export workspace backup</button>
        <button className="btn" type="button" onClick={() => void exportProject()}>Export active project</button>
        <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Import and merge</button>
        <input ref={fileRef} type="file" accept="application/json,application/zip,.json,.zip" hidden onChange={(event) => void importWorkspace(event)} />
      </div>
    </div>
  );
}

function SettingsPanel({ editor, aiSettings, apiKey, apiKeySaved, locale, localePreference, onLocaleChange, onAiSettingsChange, onApiKeyChange, onApiKeyClear, onRefresh, onStatus }) {
  const [title, setTitle] = useState(editor?.metadata?.title ?? "");
  const [plan, setPlan] = useState("");
  const [theme, setTheme] = useState("small kingdom");
  const [count, setCount] = useState(8);
  const [setupCheck, setSetupCheck] = useState({ state: "idle", message: "" });
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [fetchedModels, setFetchedModels] = useState([]);
  const normalizedAiSettings = normalizeAiSettings(aiSettings);
  const transientApiKey = typeof apiKey === "string" ? apiKey : "";
  const hasTransientApiKey = Boolean(transientApiKey.trim());
  const hasUsableApiKey = hasTransientApiKey || apiKeySaved;
  const endpointPreset = getEndpointPreset(normalizedAiSettings.endpointPresetId);
  const modelPresets = mergeAiModelOptions(getModelPresetsForEndpoint(normalizedAiSettings), fetchedModels);
  const protocolLabel = AI_PROTOCOLS.find(([id]) => id === normalizedAiSettings.protocol)?.[1] ?? normalizedAiSettings.protocol;

  useEffect(() => setTitle(editor?.metadata?.title ?? ""), [editor?.metadata?.title]);
  useEffect(() => setFetchedModels([]), [normalizedAiSettings.baseUrl, normalizedAiSettings.protocol]);

  async function saveTitle() {
    await api("/api/editor/metadata", { method: "PATCH", body: { metadata: { title } } });
    onStatus(tr(locale, "Project title saved"));
    await onRefresh();
  }

  async function buildPlan() {
    const result = await api("/api/connector/plan", {
      method: "POST",
      body: {
        config: buildAiConnectorConfig(
          normalizedAiSettings,
          { theme, cardCount: count },
          { hasApiKey: hasUsableApiKey }
        )
      }
    });
    setPlan(JSON.stringify(result, null, 2));
  }

  function updateAiSetting(key, value) {
    onAiSettingsChange(normalizeAiSettings({ ...normalizedAiSettings, [key]: value }));
  }

  function applyEndpointPreset(presetId) {
    const preset = getEndpointPreset(presetId);
    const firstModel = preset.models[0] ?? null;
    onAiSettingsChange(normalizeAiSettings({
      ...normalizedAiSettings,
      baseUrl: preset.baseUrl,
      endpointPresetId: preset.id,
      endpointIconKey: preset.iconKey,
      compatibilityFamily: preset.compatibilityFamily,
      protocol: preset.protocol,
      routeMode: "auto",
      modelId: firstModel?.id ?? "",
      modelPresetId: firstModel?.id ?? null,
      capabilities: firstModel ? normalizeCapabilityState(firstModel.capabilities) : normalizedAiSettings.capabilities
    }));
  }

  function updateEndpointBaseUrl(value) {
    const matched = findEndpointPresetByBaseUrl(value);
    if (matched) {
      onAiSettingsChange(normalizeAiSettings({
        ...normalizedAiSettings,
        baseUrl: value,
        endpointPresetId: matched.id,
        endpointIconKey: matched.iconKey,
        compatibilityFamily: matched.compatibilityFamily,
        protocol: matched.protocol,
        modelPresetId: null
      }));
      return;
    }
    onAiSettingsChange(normalizeAiSettings({
      ...normalizedAiSettings,
      baseUrl: value,
      endpointPresetId: "custom",
      endpointIconKey: "custom",
      compatibilityFamily: "custom",
      modelPresetId: null
    }));
  }

  function applyModelPreset(modelId) {
    const model = modelPresets.find((preset) => preset.id === modelId);
    if (!model) {
      updateModelId(normalizedAiSettings.modelId);
      return;
    }
    onAiSettingsChange(normalizeAiSettings({
      ...normalizedAiSettings,
      modelId: model.id,
      modelPresetId: model.id,
      protocol: model.protocol ?? normalizedAiSettings.protocol,
      capabilities: normalizeCapabilityState(model.capabilities)
    }));
  }

  function updateModelId(value) {
    const matched = findModelPresetByModelId(normalizedAiSettings, value);
    if (matched) {
      onAiSettingsChange(normalizeAiSettings({
        ...normalizedAiSettings,
        modelId: value,
        modelPresetId: matched.id,
        protocol: matched.protocol ?? normalizedAiSettings.protocol,
        capabilities: normalizeCapabilityState(matched.capabilities)
      }));
      return;
    }
    onAiSettingsChange(normalizeAiSettings({
      ...normalizedAiSettings,
      modelId: value,
      modelPresetId: null
    }));
  }

  function toggleCapability(key) {
    onAiSettingsChange(normalizeAiSettings({
      ...normalizedAiSettings,
      capabilities: {
        ...normalizedAiSettings.capabilities,
        [key]: !normalizedAiSettings.capabilities?.[key]
      }
    }));
  }

  async function testEndpoint() {
    const baseUrl = normalizedAiSettings.baseUrl.trim();
    const modelId = normalizedAiSettings.modelId.trim();
    if (!baseUrl || !modelId) {
      setSetupCheck({ state: "error", message: "Base URL and model id are required before endpoint planning." });
      return;
    }
    try {
      new URL(baseUrl);
    } catch {
      setSetupCheck({ state: "error", message: "Base URL is not a valid URL." });
      return;
    }
    if (!hasUsableApiKey && normalizedAiSettings.compatibilityFamily !== "local") {
      setSetupCheck({ state: "warning", message: `${protocolLabel} request shape is valid, but no API key is set.` });
      return;
    }
    setSetupCheck({ state: "checking", message: `Validating ${protocolLabel} endpoint with ${modelId}...` });
    try {
      const result = await api("/api/ai/edit/validate", {
        method: "POST",
        body: {
          config: buildAiConnectorConfig(normalizedAiSettings, {}, { hasApiKey: hasUsableApiKey }),
          credentials: {
            apiKey: transientApiKey
          }
        }
      });
      setSetupCheck({
        state: "success",
        message: `${protocolLabel} endpoint validated for ${result.provider?.model ?? modelId}.`
      });
      onStatus(`AI endpoint validated: ${result.provider?.protocol ?? normalizedAiSettings.protocol}`);
    } catch (error) {
      const message = formatAiEndpointError(error);
      setSetupCheck({ state: "error", message });
      onStatus(message);
    }
  }

  async function fetchEndpointModels() {
    const baseUrl = normalizedAiSettings.baseUrl.trim();
    if (!baseUrl) {
      setSetupCheck({ state: "error", message: "Base URL is required before fetching models." });
      return;
    }
    try {
      new URL(baseUrl);
    } catch {
      setSetupCheck({ state: "error", message: "Base URL is not a valid URL." });
      return;
    }
    if (!hasUsableApiKey && normalizedAiSettings.compatibilityFamily !== "local") {
      setSetupCheck({ state: "warning", message: "API key is required before fetching provider models." });
      return;
    }
    setSetupCheck({ state: "checking", message: "Fetching models from /models..." });
    try {
      const result = await api("/api/ai/edit/models", {
        method: "POST",
        body: {
          config: buildAiConnectorConfig(normalizedAiSettings, {}, { hasApiKey: hasUsableApiKey }),
          credentials: {
            apiKey: transientApiKey
          }
        }
      });
      const models = Array.isArray(result.models) ? result.models : [];
      setFetchedModels(models);
      if (!normalizedAiSettings.modelId.trim() && models[0]?.id) {
        updateModelId(models[0].id);
      }
      setSetupCheck({
        state: "success",
        message: models.length ? `Loaded ${models.length} model${models.length === 1 ? "" : "s"} from /models.` : "The endpoint returned no models."
      });
      onStatus(models.length ? `Loaded ${models.length} AI models` : "AI endpoint returned no models");
    } catch (error) {
      const message = formatAiEndpointError(error);
      setSetupCheck({ state: "error", message });
      onStatus(message);
    }
  }

  return (
    <section className="panel">
      {import.meta.env.VITE_CREATOR_HOST === "browser" && <HostedWorkspaceTools onRefresh={onRefresh} onStatus={onStatus} />}
      <PanelHead title="Settings / Pipeline" note="Project metadata, AI endpoint posture, locale hooks, and connector planning." />
      <div className="subsection interface-settings">
        <div>
          <h3>{tr(locale, "Interface")}</h3>
          <p className="muted">{tr(locale, "Interface language is shared by browser, local, and desktop clients.")}</p>
        </div>
        <label className="interface-settings__language">
          <span>{tr(locale, "Language")}</span>
          <select value={localePreference} onChange={(event) => onLocaleChange(event.target.value)}>
            {UI_LOCALES.map(([id, label]) => <option key={id} value={id}>{tr(locale, label)}</option>)}
          </select>
        </label>
      </div>
      <div className="subsection">
        <h3>{tr(locale, "Project")}</h3>
        <div className="field-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={tr(locale, "Deck title")} />
          <button className="btn" onClick={() => void saveTitle()}>{tr(locale, "Save title")}</button>
        </div>
      </div>
      <div className="subsection">
        <h3>{tr(locale, "AI Endpoint")}</h3>
        <div className="ai-channel-form">
          <div className="ai-form-row">
            <label className="ai-field-label">{tr(locale, "Channel Type")}</label>
            <AiProviderDropdown value={normalizedAiSettings.endpointPresetId} onChange={applyEndpointPreset} />
          </div>
          <div className="ai-form-row">
            <label className="ai-field-label" htmlFor="ai-base-url">{tr(locale, "Base URL")}</label>
            <input
              id="ai-base-url"
              value={normalizedAiSettings.baseUrl}
              onChange={(event) => updateEndpointBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              aria-label="Endpoint base URL"
            />
          </div>
          <div className="ai-form-row">
            <label className="ai-field-label" htmlFor="ai-api-key">{tr(locale, "API Key")}</label>
            <div className="secret-input">
              <input
                id="ai-api-key"
                type={apiKeyVisible ? "text" : "password"}
                value={transientApiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                placeholder={apiKeySaved ? "Saved in config.toml; type to replace" : "Saved in local config.toml"}
              />
              <button
                className={apiKeyVisible ? "secret-input__toggle secret-input__toggle--active" : "secret-input__toggle"}
                type="button"
                onClick={() => setApiKeyVisible((visible) => !visible)}
                aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}
                title={apiKeyVisible ? "Hide API key" : "Show API key"}
              >
                <span className="eye-mark" aria-hidden="true" />
              </button>
              {apiKeySaved && <button className="btn btn--ghost btn--compact" type="button" onClick={() => void onApiKeyClear()}>Clear</button>}
            </div>
          </div>
          <div className="ai-form-row">
            <label className="ai-field-label">{tr(locale, "Model")}</label>
            <div className="ai-model-control">
              <AiModelDropdown models={modelPresets} value={normalizedAiSettings.modelId} providerLabel={endpointPreset.label} onChange={applyModelPreset} />
              <input
                id="ai-model-id"
                value={normalizedAiSettings.modelId}
                onChange={(event) => updateModelId(event.target.value)}
                placeholder="gpt-5, claude-sonnet-4-20250514, deepseek-chat..."
                aria-label="Model ID"
              />
              <button className="btn models-fetch-btn" type="button" onClick={() => void fetchEndpointModels()}>{tr(locale, "Fetch /models")}</button>
            </div>
          </div>
          <div className="ai-form-row ai-form-row--stack">
            <span className="ai-field-label">{tr(locale, "Capabilities")}</span>
            <div className="capability-grid" aria-label="Model capabilities">
              {AI_CAPABILITIES.map(([id, label]) => (
                <button
                  key={id}
                  className={normalizedAiSettings.capabilities?.[id] ? "capability-chip capability-chip--active" : "capability-chip"}
                  type="button"
                  onClick={() => toggleCapability(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <details className="ai-advanced">
          <summary>
            <span className="ai-field-label">{tr(locale, "Advanced")}</span>
            <span>{tr(locale, "Protocol, route, compatibility, and JSON mode")}</span>
          </summary>
          <div className="ai-advanced-grid">
            <AiOptionGroup label={tr(locale, "Protocol")} value={normalizedAiSettings.protocol} options={AI_PROTOCOLS} onChange={(value) => updateAiSetting("protocol", value)} />
            <AiOptionGroup label={tr(locale, "Route mode")} value={normalizedAiSettings.routeMode} options={AI_ROUTE_MODES} onChange={(value) => updateAiSetting("routeMode", value)} />
            <AiOptionGroup label={tr(locale, "Compatibility")} value={normalizedAiSettings.compatibilityFamily} options={AI_COMPATIBILITY_FAMILIES} onChange={(value) => updateAiSetting("compatibilityFamily", value)} />
            <AiOptionGroup label={tr(locale, "JSON mode")} value={normalizedAiSettings.jsonMode} options={AI_JSON_MODES} onChange={(value) => updateAiSetting("jsonMode", value)} />
          </div>
        </details>
        <div className="action-row">
          <button className="btn btn--primary endpoint-validate-btn" type="button" onClick={() => void testEndpoint()}>{tr(locale, "Validate endpoint")}</button>
          <span className={`endpoint-check endpoint-check--${setupCheck.state}`}>
            {setupCheck.message || tr(locale, "Configured endpoints are used when drafting AI Assist plans.")}
          </span>
        </div>
      </div>
      <div className="subsection">
        <h3>{tr(locale, "Connector Request Preview")}</h3>
        <div className="field-row field-row--compact">
          <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="theme" />
          <input type="number" min="1" value={count} onChange={(event) => setCount(Number(event.target.value))} />
          <button className="btn btn--primary" onClick={() => void buildPlan()}>{tr(locale, "Build plan")}</button>
        </div>
        <pre className="output">{plan || tr(locale, "No connector plan generated.")}</pre>
      </div>
    </section>
  );
}

function AiAmbientLayer({ activePanelLabel, graphSelection, onAction }) {
  const [phase, setPhase] = useState("loading");
  const [selection, setSelection] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [cardOffset, setCardOffset] = useState({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState("");
  const [hoveredControl, setHoveredControl] = useState("");
  const borderCanvasRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    setPhase("loading");
    const timer = window.setTimeout(() => setPhase("ready"), 920);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "ready") return undefined;
    const canvas = borderCanvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;

    let frameId = 0;
    let lastCanvasWidth = 0;
    let lastCanvasHeight = 0;
    let lastFrameWidth = 0;
    let lastFrameHeight = 0;
    let lastRatio = 0;
    const startedAt = performance.now();

    function resizeCanvas() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvasWidth = window.innerWidth;
      const canvasHeight = window.innerHeight;
      const frameWidth = document.documentElement?.clientWidth || canvasWidth;
      const frameHeight = document.documentElement?.clientHeight || canvasHeight;
      if (
        canvasWidth === lastCanvasWidth &&
        canvasHeight === lastCanvasHeight &&
        frameWidth === lastFrameWidth &&
        frameHeight === lastFrameHeight &&
        ratio === lastRatio
      ) return;
      lastCanvasWidth = canvasWidth;
      lastCanvasHeight = canvasHeight;
      lastFrameWidth = frameWidth;
      lastFrameHeight = frameHeight;
      lastRatio = ratio;
      canvas.width = Math.max(1, Math.round(canvasWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvasHeight * ratio));
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function colorAt(progress, alpha) {
      const normalized = ((progress % 1) + 1) % 1;
      const hue = Math.round(normalized * 360);
      const wave = 0.5 + 0.5 * Math.cos((normalized - 0.12) * Math.PI * 2);
      const lightness = 62 + wave * 19;
      const opacity = alpha * (0.46 + wave * 0.46);
      return `hsla(${hue}, 94%, ${lightness}%, ${opacity})`;
    }

    function addPerimeterStops(gradient, startDistance, endDistance, perimeter, offset, alpha) {
      const stops = [0, 0.12, 0.24, 0.36, 0.5, 0.64, 0.76, 0.88, 1];
      stops.forEach((stop) => {
        const distance = startDistance + (endDistance - startDistance) * stop;
        const progress = distance / perimeter - offset;
        gradient.addColorStop(stop, colorAt(progress, alpha));
      });
    }

    function paintEdge(gradient, x, y, width, height, alpha) {
      context.fillStyle = gradient;
      context.globalAlpha = alpha;
      context.fillRect(x, y, width, height);
    }

    function draw(now) {
      resizeCanvas();
      const canvasWidth = lastCanvasWidth;
      const canvasHeight = lastCanvasHeight;
      const width = lastFrameWidth;
      const height = lastFrameHeight;
      const phaseOffset = ((now - startedAt) % 54000) / 54000;
      const thickness = 4;
      const glow = 12;
      const perimeter = Math.max(1, (width + height) * 2);

      context.clearRect(0, 0, canvasWidth, canvasHeight);

      const top = context.createLinearGradient(0, 0, width, 0);
      addPerimeterStops(top, 0, width, perimeter, phaseOffset, 1);
      const right = context.createLinearGradient(width, 0, width, height);
      addPerimeterStops(right, width, width + height, perimeter, phaseOffset, 1);
      const bottom = context.createLinearGradient(width, height, 0, height);
      addPerimeterStops(bottom, width + height, width * 2 + height, perimeter, phaseOffset, 1);
      const left = context.createLinearGradient(0, height, 0, 0);
      addPerimeterStops(left, width * 2 + height, perimeter, perimeter, phaseOffset, 1);

      paintEdge(top, 0, 0, width, glow, 0.16);
      paintEdge(right, width - glow, 0, glow, height, 0.14);
      paintEdge(bottom, 0, height - glow, width, glow, 0.16);
      paintEdge(left, 0, 0, glow, height, 0.14);

      paintEdge(top, 0, 0, width, thickness, 0.92);
      paintEdge(right, width - thickness, 0, thickness, height, 0.86);
      paintEdge(bottom, 0, height - thickness, width, thickness, 0.92);
      paintEdge(left, 0, 0, thickness, height, 0.86);

      context.globalAlpha = 1;
      frameId = window.requestAnimationFrame(draw);
    }

    frameId = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resizeCanvas);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [phase]);

  useEffect(() => {
    setSelection(null);
    setExpanded(false);
    setPinned(false);
    setCardOffset({ x: 0, y: 0 });
    setHoveredControl("");
    setPrompt("");
  }, [activePanelLabel]);

  useEffect(() => {
    if (graphSelection) {
      setSelection(graphSelection);
      setExpanded(false);
      setPinned(false);
      setCardOffset({ x: 0, y: 0 });
      setHoveredControl("");
      setPrompt("");
      return;
    }
    setSelection((current) => current?.source === "graph" ? null : current);
    setExpanded(false);
    setPinned(false);
    setCardOffset({ x: 0, y: 0 });
    setHoveredControl("");
  }, [graphSelection]);

  useEffect(() => {
    function isAiSurface(target) {
      return target?.closest?.(".ai-ambient, .ai-preflight");
    }

    function elementAtPointIgnoringAi(x, y) {
      const stack = document.elementsFromPoint?.(x, y) ?? [];
      return stack.find((element) => !isAiSurface(element)) ?? null;
    }

    function ownsPoint(element, point) {
      if (!element) return false;
      const hit = elementAtPointIgnoringAi(point.x, point.y);
      if (!hit) return false;
      const target = element.closest?.("[data-ai-target]");
      return element === hit || element.contains(hit) || target === hit || target?.contains(hit);
    }

    function isMeaningfullyVisible(rect, element) {
      if (!element || rect.width < 10 || rect.height < 10) return false;
      const insetX = Math.min(10, Math.max(2, rect.width * 0.18));
      const insetY = Math.min(10, Math.max(2, rect.height * 0.18));
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const points = [
        center,
        { x: rect.left + insetX, y: rect.top + insetY },
        { x: rect.left + rect.width - insetX, y: rect.top + insetY },
        { x: rect.left + insetX, y: rect.top + rect.height - insetY },
        { x: rect.left + rect.width - insetX, y: rect.top + rect.height - insetY }
      ].filter((point) => (
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= window.innerWidth &&
        point.y <= window.innerHeight
      ));
      return points.some((point) => ownsPoint(element, point));
    }

    function visibleSelectionRect(rect, element) {
      const margin = 8;
      const stripReserve = 30;
      const left = Math.max(margin, rect.left);
      const top = Math.max(margin, rect.top);
      const right = Math.min(window.innerWidth - margin, rect.right);
      const bottom = Math.min(window.innerHeight - margin - stripReserve, rect.bottom);
      if (right <= left || bottom <= top) return null;
      const visibleRect = {
        left,
        top,
        width: right - left,
        height: bottom - top
      };
      return isMeaningfullyVisible(visibleRect, element) ? visibleRect : null;
    }

    function selectionRadius(element) {
      if (!element || element === document.documentElement || element === document.body) return "0px";
      const style = window.getComputedStyle(element);
      return style.borderRadius || "0px";
    }

    function selectionFromElement(element) {
      const rect = element.getBoundingClientRect();
      const visibleRect = visibleSelectionRect(rect, element);
      if (!visibleRect) return null;
      return {
        source: "element",
        type: element.dataset.aiTarget || "object",
        label: element.dataset.aiLabel || element.dataset.aiTarget || activePanelLabel,
        context: element.dataset.aiContext || "",
        targetCardId: element.dataset.aiCardId || null,
        anchorElement: element,
        rect: {
          ...visibleRect,
          radius: selectionRadius(element)
        }
      };
    }

    function selectionFromFormControl(element) {
      if (!element?.matches?.("input, textarea")) return null;
      let start;
      let end;
      try {
        start = element.selectionStart;
        end = element.selectionEnd;
      } catch {
        return null;
      }
      if (typeof start !== "number" || typeof end !== "number" || start === end) return null;
      const text = element.value.slice(Math.min(start, end), Math.max(start, end)).trim();
      if (!text) return null;
      const rect = element.getBoundingClientRect();
      const visibleRect = visibleSelectionRect(rect, element);
      if (!visibleRect) return null;
      const target = element.closest("[data-ai-target]");
      const contextHint = inferAiSelectionContext(element, target, activePanelLabel);
      return {
        source: "field",
        type: target?.dataset.aiTarget || "field selection",
        label: target?.dataset.aiLabel || contextHint || element.getAttribute("name") || element.placeholder || activePanelLabel,
        context: target?.dataset.aiContext || contextHint || "Selected field text",
        targetCardId: target?.dataset.aiCardId || null,
        anchorElement: element,
        text,
        rect: {
          ...visibleRect,
          radius: selectionRadius(element)
        }
      };
    }

    function selectionFromRange() {
      const nativeSelection = window.getSelection?.();
      const text = nativeSelection?.toString?.().trim() ?? "";
      if (!text || nativeSelection.rangeCount === 0) return null;
      const range = nativeSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const anchorElement = nativeSelection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? nativeSelection.anchorNode
        : nativeSelection.anchorNode?.parentElement;
      const target = anchorElement?.closest?.("[data-ai-target]");
      const radiusSource = target || anchorElement;
      const visibleRect = visibleSelectionRect(rect, radiusSource);
      if (!visibleRect) return null;
      const contextHint = inferAiSelectionContext(anchorElement, target, activePanelLabel);
      return {
        source: "text",
        type: target?.dataset.aiTarget || "text selection",
        label: target?.dataset.aiLabel || contextHint || activePanelLabel,
        context: target?.dataset.aiContext || contextHint || "Selected text",
        targetCardId: target?.dataset.aiCardId || null,
        anchorElement: target || anchorElement,
        text,
        rect: {
          ...visibleRect,
          radius: selectionRadius(radiusSource)
        }
      };
    }

    function captureSelection(event) {
      if (isAiSurface(event.target)) return;
      window.setTimeout(() => {
        const textSelection = selectionFromFormControl(event.target) || selectionFromRange();
        if (textSelection) {
          setSelection(textSelection);
          setExpanded(false);
          setPinned(false);
          setCardOffset({ x: 0, y: 0 });
          setPrompt("");
        }
      }, 0);
    }

    function captureClick(event) {
      if (isAiSurface(event.target)) return;
      const target = event.target?.closest?.("[data-ai-target]");
      if (!target) {
        setSelection(null);
        setExpanded(false);
        setPrompt("");
        return;
      }
      const next = selectionFromElement(target);
      if (!next) return;
      setSelection(next);
      setExpanded(false);
      setPinned(false);
      setCardOffset({ x: 0, y: 0 });
      setPrompt("");
    }

    function clearFloatingSelection() {
      setSelection(null);
      setExpanded(false);
      setPinned(false);
      setCardOffset({ x: 0, y: 0 });
      setPrompt("");
    }

    function refreshFloatingSelection() {
      setSelection((current) => {
        if (!current) return current;
        if (current.source === "graph") return current;
        let refreshed = null;
        if (current.source === "field" && current.anchorElement?.isConnected) {
          refreshed = selectionFromFormControl(current.anchorElement);
        } else if (current.source === "text") {
          const nativeSelection = window.getSelection?.();
          if (nativeSelection?.rangeCount) refreshed = selectionFromRange();
          if (!refreshed && current.anchorElement?.isConnected) refreshed = selectionFromElement(current.anchorElement);
        } else if (current.anchorElement?.isConnected) {
          refreshed = selectionFromElement(current.anchorElement);
        }
        if (refreshed) return { ...current, ...refreshed, hidden: false };
        if (current.anchorElement?.isConnected) return { ...current, hidden: true };
        return null;
      });
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        clearFloatingSelection();
      }
    }

    document.addEventListener("mouseup", captureSelection);
    document.addEventListener("keyup", captureSelection);
    document.addEventListener("click", captureClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", refreshFloatingSelection, true);
    window.addEventListener("resize", clearFloatingSelection);
    return () => {
      document.removeEventListener("mouseup", captureSelection);
      document.removeEventListener("keyup", captureSelection);
      document.removeEventListener("click", captureClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", refreshFloatingSelection, true);
      window.removeEventListener("resize", clearFloatingSelection);
    };
  }, [activePanelLabel]);

  const rect = selection?.hidden ? null : selection?.rect;
  const suggestions = getAiSelectionSuggestions(selection);
  const popover = rect ? getAiPopoverLayout(rect) : null;
  const selectedTextPreview = formatAiSelectionText(selection?.text);
  const contextPreview = formatAiSelectionContext(selection, selectedTextPreview);

  function runAction(actionId) {
    if (!selection) return;
    onAction?.(actionId, selection, prompt);
    setPrompt("");
    setExpanded(false);
  }

  function closeSelection() {
    setSelection(null);
    setExpanded(false);
    setPinned(false);
    setCardOffset({ x: 0, y: 0 });
    setHoveredControl("");
    setPrompt("");
  }

  function startCardDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    setExpanded(true);
    setPinned(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cardOffset.x,
      originY: cardOffset.y
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveCard(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCardOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    });
  }

  function endCardDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  return (
    <div className={`ai-ambient ai-ambient--${phase}`} aria-live="polite">
      <div className="ai-ambient__wash" aria-hidden="true" />
      <div className="ai-ambient__liquid" aria-hidden="true" />
      <div className="ai-ambient__frame" aria-hidden="true">
        <canvas ref={borderCanvasRef} className="ai-ambient__border-canvas" />
      </div>
      {phase === "loading" && (
        <div className="ai-ambient__loading" role="status">
          <span />
          <strong>Preparing AI context</strong>
        </div>
      )}
      {rect && (
        <>
          <div
            className="ai-selection-aura"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              borderRadius: rect.radius
            }}
            aria-hidden="true"
          />
          <div
            className={`ai-selection-popover ai-selection-popover--${popover.placement} ${expanded ? "ai-selection-popover--expanded" : ""}`}
            style={{
              left: popover.left,
              top: popover.top,
              "--ai-bar-width": `${popover.barWidth}px`,
              "--ai-card-width": `${popover.width}px`,
              "--ai-card-left": `${popover.cardLeft}px`,
              "--ai-selection-height": `${rect.height}px`,
              "--ai-card-offset-x": `${cardOffset.x}px`,
              "--ai-card-offset-y": `${cardOffset.y}px`
            }}
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => {
              if (!pinned) setExpanded(false);
            }}
            onFocus={() => setExpanded(true)}
          >
            <button
              className="ai-selection-handle"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <span aria-hidden="true" />
            </button>
            <div className="ai-selection-card" role="dialog" aria-label="AI actions for selection">
              <div className="ai-selection-card__toolbar" aria-label="AI card controls">
                <button
                  className={`ai-selection-card__drag ${hoveredControl === "drag" ? "ai-selection-card__control--hovered" : ""}`}
                  type="button"
                  title="Move"
                  aria-label="Move AI card"
                  onPointerEnter={() => setHoveredControl("drag")}
                  onPointerLeave={() => setHoveredControl("")}
                  onPointerDown={startCardDrag}
                  onPointerMove={moveCard}
                  onPointerUp={endCardDrag}
                  onPointerCancel={endCardDrag}
                >
                  <span className="ai-selection-card__drag-bar" aria-hidden="true" />
                </button>
                <div className="ai-selection-card__controls">
                  <button
                    className={`ai-selection-card__pin ${pinned ? "ai-selection-card__pin--active" : ""} ${hoveredControl === "pin" ? "ai-selection-card__control--hovered" : ""}`}
                    type="button"
                    title={pinned ? "Unpin" : "Pin"}
                    aria-label={pinned ? "Unpin AI card" : "Pin AI card"}
                    aria-pressed={pinned}
                    onPointerEnter={() => setHoveredControl("pin")}
                    onPointerLeave={() => setHoveredControl("")}
                    onClick={() => setPinned((value) => !value)}
                  >
                    <span className="ai-selection-card__control-bg" aria-hidden="true" />
                    <AiControlIcon id="pin" />
                  </button>
                  <button
                    className={`ai-selection-card__close ${hoveredControl === "close" ? "ai-selection-card__control--hovered" : ""}`}
                    type="button"
                    title="Close"
                    aria-label="Close AI card"
                    onPointerEnter={() => setHoveredControl("close")}
                    onPointerLeave={() => setHoveredControl("")}
                    onClick={closeSelection}
                  >
                    <span className="ai-selection-card__control-bg" aria-hidden="true" />
                    <AiControlIcon id="close" />
                  </button>
                </div>
              </div>
              <div className="ai-selection-card__head">
                <span>{selection.type}</span>
                <strong>{selection.label}</strong>
                {selectedTextPreview && <em title={selection.text}>{selectedTextPreview}</em>}
                {contextPreview && <small>{contextPreview}</small>}
              </div>
              <div className="ai-selection-card__suggestions">
                {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}
              </div>
              <div className="ai-selection-card__quick" aria-label="Quick AI actions">
                {AI_AMBIENT_ACTIONS.map(([id, label, title]) => (
                  <button key={id} type="button" title={title} aria-label={label} onClick={() => runAction(id)}>
                    <AiActionIcon id={id} />
                  </button>
                ))}
              </div>
              <div className="ai-selection-card__prompt">
                <input
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runAction("rewrite");
                    }
                  }}
                  placeholder="Add direction..."
                />
                <button type="button" onClick={() => runAction("rewrite")}>Ask</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatAiSelectionText(text) {
  const normalized = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "";
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}

function formatAiSelectionContext(selection, textPreview = "") {
  const context = selection?.context?.replace(/\s+/g, " ").trim() ?? "";
  if (!context) return "";
  const label = selection?.label?.replace(/\s+/g, " ").trim() ?? "";
  const normalizedText = textPreview.replace(/\s+/g, " ").trim();
  if (context === label || context === normalizedText) return "";
  return context.length > 64 ? `${context.slice(0, 61)}...` : context;
}

function inferAiSelectionContext(element, target, fallback) {
  if (target?.dataset.aiLabel) return target.dataset.aiLabel;
  if (target?.dataset.aiContext) return target.dataset.aiContext;

  const closest = element?.closest?.(".metric, label, .review-panel-block, .review-card-row, .panel, .subsection, .card-editor, .choice-editor");
  if (!closest) return fallback;

  if (closest.matches(".metric")) {
    return closest.querySelector("span")?.textContent?.trim() || fallback;
  }
  if (closest.matches("label")) {
    const clone = closest.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, button").forEach((node) => node.remove());
    return clone.textContent?.trim() || fallback;
  }
  const heading = closest.querySelector("h2, h3, strong, .review-panel-block__head strong, .review-card-row__head strong");
  return heading?.textContent?.trim() || fallback;
}

function getAiPopoverLayout(rect) {
  const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);
  const viewportWidth = Math.max(320, window.innerWidth || 320);
  const viewportHeight = Math.max(320, window.innerHeight || 320);
  const margin = 12;
  const anchorX = rect.left + rect.width / 2;
  const left = clampNumber(rect.left, margin, Math.max(margin, viewportWidth - margin - rect.width));
  const barWidth = Math.min(rect.width, viewportWidth - margin * 2);
  const cardWidth = Math.min(viewportWidth - margin * 2, Math.max(300, Math.min(barWidth, 430)));
  const preferredCardLeft = anchorX - cardWidth / 2 - left;
  const cardLeft = clampNumber(preferredCardLeft, margin - left, viewportWidth - margin - cardWidth - left);
  const anchorTop = clampNumber(rect.top + rect.height, margin + 24, viewportHeight - margin - 24);
  const estimatedExpandedHeight = 292;
  const spaceBelow = viewportHeight - anchorTop - margin;
  const spaceAbove = anchorTop - margin;
  const placement = spaceBelow >= estimatedExpandedHeight || spaceBelow >= spaceAbove ? "below" : "above";
  return {
    left,
    top: anchorTop,
    width: cardWidth,
    cardLeft,
    barWidth,
    placement
  };
}

function getAiSelectionSuggestions(selection) {
  if (!selection) return [];
  if (selection.type?.includes("issue")) {
    return ["Suggest the smallest repair", "Explain why this is risky", "Draft a safer route"];
  }
  if (selection.type?.includes("edge")) {
    return ["Make this branch harder to reach", "Explain this connection", "Draft a bridge card"];
  }
  if (selection.type?.includes("node") || selection.type?.includes("card")) {
    return ["Tighten the card wording", "Draft a follow-up branch", "Explain state changes"];
  }
  return ["Rewrite for clarity", "Translate this selection", "Explain author impact"];
}

function AiActionIcon({ id }) {
  const paths = {
    rewrite: <path d="M5 15.5 15.5 5l3.5 3.5L8.5 19H5v-3.5Zm9-9L17.5 10" />,
    translate: <path d="M4 6h8M8 4v2m-3 5c2.5-.5 4.5-2 5.5-5M7 8c.7 1.5 1.8 2.7 3.5 3.5M13 19l3-7 3 7m-4.2-2h2.4" />,
    explain: <path d="M12 18h.01M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.9.7-1.7 1.3-1.7 2.7M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
    branch: <path d="M6 4v5a4 4 0 0 0 4 4h8M6 20v-5a4 4 0 0 1 4-4h2m3-3 3 3-3 3m0 2 3 3-3 3" />
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[id] ?? paths.explain}
    </svg>
  );
}

function AiControlIcon({ id }) {
  const paths = {
    pin: <path fill="currentColor" d="M13.694 1.894c-.442-.442-1.06-.384-1.45.006-.379.378-.344 1.032.036 1.408l1.194 1.199-3.2 3.2c-.096.095-.267.107-.402.107l-6.31.434a.5.5 0 0 0-.359.15l-.568.567a1 1 0 0 0-.002 1.43l4.583 4.584-4.661 4.671a1 1 0 0 0 0 1.414l.015.015a1 1 0 0 0 1.415 0l4.664-4.665 4.584 4.58a1.005 1.005 0 0 0 1.422-.009l.57-.568a.5.5 0 0 0 .148-.36l.441-6.303c0-.13.025-.288.12-.383l3.201-3.2 1.199 1.191c.502.502 1.15.297 1.417.031.436-.436.379-1.063-.003-1.445zm1.227 4.058 2.833 2.83-3.828 3.835-.417 5.83-8.27-8.275 5.867-.4z" />,
    close: (
      <>
        <path d="M6.2 6.2 17.8 17.8" />
        <path d="M17.8 6.2 6.2 17.8" />
      </>
    )
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[id] ?? paths.close}
    </svg>
  );
}

function AiProgress({ step, active, status = "idle" }) {
  if (step < 0) return null;
  return (
    <div className="ai-progress" aria-label="AI Assist progress">
      {AI_PROGRESS_STEPS.map((label, index) => (
        <span
          key={label}
          className={[
            "ai-progress__step",
            index < step ? "ai-progress__step--done" : "",
            index === step ? "ai-progress__step--active" : "",
            status === "failed" && index === step ? "ai-progress__step--failed" : "",
            status === "ready" && index === AI_PROGRESS_STEPS.length - 1 ? "ai-progress__step--ready" : "",
            active && index === step ? "ai-progress__step--pulse" : ""
          ].filter(Boolean).join(" ")}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function PanelHead({ title, note }) {
  const locale = useUiLocale();
  return (
    <div className="panel-head">
      <div>
        <h2>{tr(locale, title)}</h2>
        <p>{tr(locale, note)}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "", localizeValue = false }) {
  const locale = useUiLocale();
  return (
    <div className={`metric ${tone ? `metric--${tone}` : ""}`} data-ai-target="metric" data-ai-label={label} data-ai-context={label}>
      <span>{tr(locale, label)}</span>
      <strong>{localizeValue ? tr(locale, value) : value}</strong>
    </div>
  );
}

function panelStatus(id, { editor, playerReady, diagnostics, build }) {
  if (id === "overview") return editor ? "ready" : "loading";
  if (id === "content") return `${editor?.cards?.length ?? 0}`;
  if (id === "story") return `${editor?.cards?.length ?? 0}`;
  if (id === "review") return diagnostics ? `${diagnostics.healthScore}` : "new";
  if (id === "ai-edit") return diagnostics ? "ready" : "draft";
  if (id === "preview") return playerReady ? "ready" : "blocked";
  if (id === "build") return build ? "ready" : "new";
  if (id === "settings") return editor?.metadata?.title ? "set" : "new";
  return "";
}

function choicePath(cardId, choiceId) {
  return `/api/editor/cards/${encodeURIComponent(cardId)}/choices/${encodeURIComponent(choiceId)}`;
}

function effectPath(cardId, choiceId, kind, target) {
  return `${choicePath(cardId, choiceId)}/effects/${kind}/${encodeURIComponent(target)}`;
}

function readStoredDraft() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.bundle || !Array.isArray(entry.bundle.cards)) return null;
    return entry;
  } catch {
    return null;
  }
}

function readDraftInfo() {
  const draft = readStoredDraft();
  if (!draft) return null;
  return {
    savedAt: draft.savedAt,
    cardCount: draft.cardCount ?? draft.bundle.cards.length
  };
}

function clearStoredDraft() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  }
}

function formatDraftTime(savedAt) {
  if (!savedAt) return "unknown time";
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString();
}

function cardValidationState(editor, card, index) {
  const messages = [];
  const seen = new Set();
  const append = (items = [], level) => {
    for (const text of items) {
      if (!messageBelongsToCard(String(text), card, index)) continue;
      const key = `${level}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ level, text });
    }
  };

  append(editor?.validation?.errors, "error");
  append(editor?.playerValidation?.errors, "error");
  append(editor?.validation?.warnings, "warning");
  append(editor?.playerValidation?.warnings, "warning");

  return {
    invalid: messages.some((message) => message.level === "error"),
    messages
  };
}

function messageBelongsToCard(message, card, index) {
  return (
    message.includes(`Card at index ${index}`) ||
    message.includes(`Card '${card.id}'`) ||
    message.includes(`card '${card.id}'`) ||
    message.includes(`card id '${card.id}'`)
  );
}

function matchesCardQuery(card, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    card.id,
    card.text,
    ...(card.choices ?? []).flatMap((choice) => [choice.id, choice.label])
  ].join(" ").toLowerCase();
  return haystack.includes(normalized);
}

function createFactionDraft(factions = {}) {
  return Object.fromEntries(FACTIONS.map((faction) => {
    const delta = factions?.[faction];
    return [faction, delta === undefined ? "" : String(delta)];
  }));
}

function createGaugeLabels(presentation = {}) {
  const gauges = presentation?.gauges ?? {};
  return Object.fromEntries(FACTIONS.map((faction) => {
    const label = gauges?.[faction]?.label;
    return [faction, typeof label === "string" && label.trim() ? label.trim() : faction];
  }));
}

function gaugeDisplayName(faction, gaugeLabels) {
  return gaugeLabels?.[faction] || faction;
}

function parseTagValue(text) {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "false") return null;
  if (trimmed === "true") return true;
  return trimmed;
}

function parseScalar(text) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const number = Number(trimmed);
  if (Number.isFinite(number)) return number;
  return trimmed;
}

function formatEffectValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function cardExcerpt(card) {
  const text = (card.text ?? "").trim();
  if (!text) return "No card text";
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function describeRequirements(requirements = {}, tagCatalog, gaugeLabels) {
  const groups = [
    { key: "allTags", label: "Needs all", tone: "gate" },
    { key: "anyTags", label: "Needs one", tone: "gate" },
    { key: "noneTags", label: "Hidden while", tone: "danger" }
  ];
  const rows = groups.flatMap((group) => {
    const tags = normalizeTagArray(requirements?.[group.key]).map((tag) => describeTag(tag, tagCatalog));
    return tags.length > 0 ? [{ ...group, tags }] : [];
  });
  const variableItems = Object.entries(requirements.variables ?? {})
    .sort(compareEntriesByKey)
    .map(([key, value]) => ({
      key,
      label: `${key} = ${formatSummaryValue(value)}`
    }));
  if (variableItems.length > 0) {
    rows.push({
      key: "variables",
      label: "Story variables",
      tone: "variable",
      tags: variableItems
    });
  }

  const factionItems = Object.entries(requirements.factions ?? {})
    .sort(compareFactionEntries)
    .map(([key, rule]) => ({
      key,
      label: formatFactionRequirement(key, rule, gaugeLabels)
    }));
  if (factionItems.length > 0) {
    rows.push({
      key: "factions",
      label: "Gauge state",
      tone: "gate",
      tags: factionItems
    });
  }

  if (rows.length === 0) {
    return [{
      key: "always",
      label: "No gates",
      tone: "open",
      note: "Always eligible",
      tags: []
    }];
  }

  return rows;
}

function describeChoiceEffects(effects = {}, tagCatalog, gaugeLabels) {
  const items = [];
  const factionEntries = Object.entries(effects?.factions ?? {}).sort(compareFactionEntries);

  for (const [faction, rawValue] of factionEntries) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      items.push({ tone: "neutral", label: gaugeDisplayName(faction, gaugeLabels), detail: formatSummaryValue(rawValue) });
      continue;
    }
    if (value === 0) continue;
    items.push({
      tone: value > 0 ? "positive" : "negative",
      label: gaugeDisplayName(faction, gaugeLabels),
      detail: formatFactionDelta(value)
    });
  }

  for (const [key, value] of Object.entries(effects?.tags ?? {}).sort(compareEntriesByKey)) {
    const tag = describeTag(key, tagCatalog);
    const clears = value === false || value === null;
    const hasValue = value !== true && value !== false && value !== null && value !== undefined;
    items.push({
      tone: clears ? "danger" : "tag",
      label: `${clears ? "Clear" : "Set"} ${tag.label}`,
      detail: hasValue ? formatSummaryValue(value) : (tag.label !== tag.key ? tag.key : "")
    });
  }

  for (const [key, value] of Object.entries(effects?.variables ?? {}).sort(compareEntriesByKey)) {
    items.push({
      tone: value === null ? "danger" : "variable",
      label: `${value === null ? "Clear" : "Set"} ${key}`,
      detail: value === null ? "" : formatSummaryValue(value)
    });
  }

  return items.length > 0 ? items : [{ tone: "neutral", label: "No state changes" }];
}

function formatFactionRequirement(faction, rule, gaugeLabels) {
  const label = gaugeDisplayName(faction, gaugeLabels);
  if (Number.isFinite(rule)) {
    return `${label} = ${rule}`;
  }

  const parts = [];
  if (Number.isFinite(rule?.min)) parts.push(`>= ${rule.min}`);
  if (Number.isFinite(rule?.max)) parts.push(`<= ${rule.max}`);
  if (Number.isFinite(rule?.equals)) parts.push(`= ${rule.equals}`);
  return parts.length > 0 ? `${label} ${parts.join(" and ")}` : label;
}

function normalizeTagArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean))];
}

function describeTag(key, tagCatalog) {
  return {
    key,
    label: tagDisplayName(key, tagCatalog?.byKey)
  };
}

function compareEntriesByKey([left], [right]) {
  return left.localeCompare(right);
}

function compareFactionEntries([left], [right]) {
  const leftIndex = FACTIONS.indexOf(left);
  const rightIndex = FACTIONS.indexOf(right);
  if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
}

function formatFactionDelta(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatSummaryValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function createAssetMap(assets) {
  const map = new Map();
  for (const asset of assets) {
    if (asset?.cardId) map.set(asset.cardId, asset);
  }
  return map;
}

/**
 * useTagCatalog fetches the derived tag directory from /api/editor/tags and
 * refetches whenever the editor revision changes (after any card mutation).
 * Returns { tags, byKey, loading, error }. `byKey` is a Map for quick lookup
 * when rendering semantic labels for requirement editors and graph edges.
 */
function useTagCatalog(editor) {
  const [catalog, setCatalog] = useState({ tags: [], byKey: new Map() });
  const [error, setError] = useState("");
  const editorRevision = editor?.cards?.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api("/api/editor/tags");
        if (cancelled) return;
        const byKey = new Map(result.tags.map((entry) => [entry.key, entry]));
        setCatalog({ tags: result.tags ?? [], byKey });
        setError("");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError.message);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [editorRevision]);

  return { ...catalog, error };
}

/**
 * useStoryGroups reads metadata.story.groups as a creator-facing organization
 * layer. These groups only filter/highlight the Story UI; they do not change
 * runtime scheduling or card eligibility.
 */
function useStoryGroups(editor) {
  const [projection, setProjection] = useState({ groups: [] });
  const [error, setError] = useState("");
  const editorRevision = `${editor?.cards?.length ?? 0}:${JSON.stringify(editor?.metadata?.story?.groups ?? [])}`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api("/api/editor/story-groups");
        if (cancelled) return;
        setProjection({ groups: result.groups ?? [] });
        setError("");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError.message);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [editorRevision]);

  return { ...projection, error };
}

/**
 * tagDisplayName resolves a tag key to its human label, falling back to the raw
 * key when no label is set. Used everywhere a raw key would otherwise show.
 */
function tagDisplayName(key, byKey) {
  const entry = byKey?.get(key);
  return entry?.label || key;
}

function edgeSignalLabel(edge, tagLabelsByKey, gaugeLabels) {
  const labels = [];
  const tag = (edge.tags ?? [])[0];
  if (tag) labels.push(tagDisplayName(tag, tagLabelsByKey));
  const variable = (edge.variables ?? [])[0];
  if (variable) labels.push(`var ${variable}`);
  const faction = (edge.factions ?? [])[0];
  if (faction) labels.push(gaugeDisplayName(faction, gaugeLabels));

  const total = (edge.tags?.length ?? 0) + (edge.variables?.length ?? 0) + (edge.factions?.length ?? 0);
  const visible = labels.slice(0, 2);
  const suffix = total > visible.length ? ` +${total - visible.length}` : "";
  return visible.join(" + ") + suffix;
}

createRoot(document.getElementById("root")).render(<App />);
