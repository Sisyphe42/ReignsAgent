import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";

const COPY = {
  en: {
    progress: (current, total) => `${current}/${total}`,
    back: "Back",
    next: "Next",
    finish: "Finish",
    skip: "Skip"
  },
  "zh-Hans": {
    progress: (current, total) => `${current}/${total}`,
    back: "上一步",
    next: "下一步",
    finish: "完成",
    skip: "跳过"
  }
};

const STEP_DEFINITIONS = [
  {
    id: "intro",
    kind: "intro",
    en: {
      title: "Tell a story, one decision at a time",
      body: "A Reigns-style story shows one dilemma card at a time. The player chooses left or right; that decision changes gauges and story state. Push a critical gauge too high or low and the reign ends, ready to be played again.",
      features: [
        ["Author", "Write cards, two clear choices, and data-driven branches."],
        ["Review", "Simulate many runs to expose dead paths, pacing, and balance risks."],
        ["AI Assist", "Connect your own endpoint for reviewable drafts, repairs, and visual candidates."],
        ["Ship", "Play the real experience and export a focused player build."]
      ],
      demo: {
        eyebrow: "How a Reigns-style story plays",
        card: "A traveler arrives with a warning from beyond the city walls.",
        left: "Turn them away",
        right: "Hear them out",
        hint: "Try a choice. Gauges shift, and the next possibilities change."
      }
    },
    zh: {
      title: "用一次次选择讲完一个故事",
      body: "Reigns 类玩法每次呈现一张困境卡牌，玩家只能向左或向右选择。每次决定都会改变数值与故事状态；关键数值过高或过低时，本轮统治结束，玩家可以重新开始。",
      features: [
        ["创作", "编写卡牌、两个明确选项和数据驱动的分支。"],
        ["审查", "通过大量模拟发现断路、节奏和数值风险。"],
        ["AI 辅助", "连接自己的端点，生成可审阅的草稿、修复与视觉候选。"],
        ["发布", "试玩真实体验，并导出专注于游玩的玩家端。"]
      ],
      demo: {
        eyebrow: "Reigns 类故事如何游玩",
        card: "一位旅人带着城墙之外的警告来到宫廷。",
        left: "拒之门外",
        right: "听他说完",
        hint: "试试任一选择。数值会变化，后续可能性也会随之改变。"
      }
    }
  },
  {
    id: "projects",
    target: "project-menu",
    en: { title: "Start from the right project", body: "Switch projects, begin with a blank canvas, or clone the sample without affecting the original." },
    zh: { title: "从合适的项目开始", body: "切换项目、从空白开始，或复制示例而不影响原始内容。" }
  },
  {
    id: "content",
    panelId: "content",
    target: "content",
    en: { title: "Write the decisions", body: "Shape each card, its two choices, state changes, and artwork from one focused editor." },
    zh: { title: "写下每一次选择", body: "在一个专注的编辑器中完成卡牌、左右选项、状态变化和美术。" }
  },
  {
    id: "story",
    panelId: "story",
    target: "story",
    en: { title: "See how the story moves", body: "Follow tag-driven connections, inspect branches, and spot cards the player cannot reach." },
    zh: { title: "看清故事如何流动", body: "沿着标签驱动的连接检查分支，并发现玩家无法到达的卡牌。" }
  },
  {
    id: "review",
    panelId: "review",
    target: "review",
    en: { title: "Find problems before players do", body: "Run reproducible simulations to reveal coverage, pacing, ending, and balance risks." },
    zh: { title: "在玩家之前发现问题", body: "运行可复现模拟，揭示覆盖度、节奏、结局和数值风险。" }
  },
  {
    id: "ai-assist",
    panelId: "ai-edit",
    target: "ai-assist",
    en: { title: "Use AI without giving up control", body: "AI Assist can draft cards from project context, repair Review findings, and generate or edit visual candidates through your endpoint. Every result stays a proposal until you inspect and apply it; player builds contain no AI connection or key." },
    zh: { title: "使用 AI，但始终保留控制权", body: "AI 辅助可以根据项目上下文起草卡牌、修复审查问题，并通过你的端点生成或编辑视觉候选。所有结果在你检查并应用前都只是提案；玩家构建不会包含 AI 连接或密钥。" }
  },
  {
    id: "preview",
    panelId: "preview",
    target: "preview",
    en: { title: "Play what you wrote", body: "Try the current deck with the same deterministic rules used by published builds." },
    zh: { title: "亲自试玩你的创作", body: "使用与发布构建相同的确定性规则体验当前卡组。" }
  },
  {
    id: "build",
    panelId: "build",
    target: "build",
    en: { title: "Package the player experience", body: "Check readiness, prepare the release, and export the player format supported by this host." },
    zh: { title: "打包玩家体验", body: "检查就绪状态、准备发布，并导出当前宿主支持的玩家端格式。" }
  },
  {
    id: "player",
    target: "player-launch",
    en: { title: "See only what players see", body: "Open the clean decision experience without Creator tools, diagnostics, or endpoint settings." },
    zh: { title: "只看玩家会看到的内容", body: "打开纯净的选择体验，不包含 Creator 工具、诊断或端点设置。" }
  },
  {
    id: "about-github",
    panelId: "settings",
    target: "about-github",
    interactiveTarget: true,
    en: { title: "Keep exploring on GitHub", body: "About links to the source, detailed README, releases, license, and issue tracker. You can open the highlighted GitHub link now or return whenever you need deeper documentation.", actionHref: "https://github.com/Sisyphe42/ReignsAgent", actionLabel: "Open GitHub" },
    zh: { title: "前往 GitHub 继续了解", body: "About 提供源码、详细 README、版本发布、许可证和问题追踪入口。你现在就可以打开高亮的 GitHub 链接，也可以之后随时回来查阅更完整的文档。", actionHref: "https://github.com/Sisyphe42/ReignsAgent", actionLabel: "打开 GitHub" }
  },
  {
    id: "replay",
    panelId: "settings",
    target: "onboarding-replay",
    en: { title: "Come back anytime", body: "Replay the tour from here. The guide never changes your projects or shared settings." },
    zh: { title: "随时回来再看", body: "从这里重新播放引导。导览绝不会修改项目或共享设置。" }
  }
];

export function readOnboardingCompletion() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return "unavailable";
    return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true" ? "complete" : "pending";
  } catch {
    return "unavailable";
  }
}

export function markOnboardingComplete() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    return true;
  } catch {
    return false;
  }
}

export function getOnboardingSteps(locale) {
  const isChinese = locale === "zh-Hans";
  return STEP_DEFINITIONS.map((step) => {
    const content = isChinese ? step.zh : step.en;
    return { ...content, id: step.id, kind: step.kind ?? "spotlight", panelId: step.panelId ?? null, target: step.target ?? null, interactiveTarget: step.interactiveTarget === true };
  });
}

function readTargetRect(target) {
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const padding = 8;
  return {
    top: Math.max(8, rect.top - padding),
    left: Math.max(8, rect.left - padding),
    right: Math.min(window.innerWidth - 8, rect.right + padding),
    bottom: Math.min(window.innerHeight - 8, rect.bottom + padding)
  };
}

function sameRect(left, right) {
  if (!left || !right) return left === right;
  return ["top", "left", "right", "bottom"].every((key) => Math.abs(left[key] - right[key]) < 0.5);
}

function getCardLayout(rect, height, wide = false) {
  const margin = 16;
  const gap = 16;
  const width = Math.min(wide ? 920 : 400, window.innerWidth - margin * 2);
  if (!rect) {
    return {
      width,
      left: Math.max(margin, (window.innerWidth - width) / 2),
      top: Math.max(margin, (window.innerHeight - height) / 2)
    };
  }
  const centeredLeft = rect.left + (rect.right - rect.left - width) / 2;
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, centeredLeft));
  const below = rect.bottom + gap;
  const above = rect.top - gap - height;
  const top = below + height <= window.innerHeight - margin
    ? below
    : above >= margin
      ? above
      : Math.min(window.innerHeight - height - margin, Math.max(margin, below));
  return { width, left, top };
}

export function OnboardingTour({ locale, steps, stepIndex, layoutKey, onStepChange, onFinish, onSkip }) {
  const normalizedLocale = locale === "zh-Hans" ? "zh-Hans" : "en";
  const copy = COPY[normalizedLocale];
  const step = steps[stepIndex];
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [targetRect, setTargetRect] = useState(null);
  const [cardHeight, setCardHeight] = useState(260);
  const [demoDirection, setDemoDirection] = useState("left");

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    dialogRef.current?.focus();
    return () => previousFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll("a[href], button:not([disabled])") ?? [])];
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (current <= 0 ? focusable.length - 1 : current - 1)
        : (current === focusable.length - 1 ? 0 : current + 1);
      event.preventDefault();
      focusable[next].focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onSkip]);

  useEffect(() => {
    if (step.kind !== "intro" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;
    const interval = window.setInterval(() => setDemoDirection((current) => current === "left" ? "right" : "left"), 2200);
    return () => window.clearInterval(interval);
  }, [step.kind]);

  useLayoutEffect(() => {
    if (!step.target) {
      setTargetRect(null);
      return undefined;
    }
    let frame = 0;
    let observer = null;
    let activeTarget = null;
    const selector = `[data-onboarding-target="${step.target}"]`;
    const update = () => {
      const target = document.querySelector(selector);
      const next = readTargetRect(target);
      setTargetRect((current) => sameRect(current, next) ? current : next);
    };
    frame = window.requestAnimationFrame(() => {
      const target = document.querySelector(selector);
      activeTarget = target;
      activeTarget?.setAttribute("data-onboarding-active", "true");
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
      update();
      if (target && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(update);
        observer.observe(target);
      }
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      activeTarget?.removeAttribute("data-onboarding-active");
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.id, step.target, layoutKey]);

  useLayoutEffect(() => {
    const height = dialogRef.current?.getBoundingClientRect().height;
    if (height && Math.abs(height - cardHeight) > 0.5) setCardHeight(height);
  }, [step.id, targetRect, cardHeight]);

  const isIntro = step.kind === "intro";
  const cardLayout = useMemo(() => getCardLayout(targetRect, cardHeight, isIntro), [targetRect, cardHeight, isIntro]);
  const isLast = stepIndex === steps.length - 1;
  const rectStyle = targetRect ? {
    top: targetRect.top,
    left: targetRect.left,
    width: targetRect.right - targetRect.left,
    height: targetRect.bottom - targetRect.top
  } : null;

  return (
    <div className="onboarding-tour" data-testid="onboarding-tour">
      {targetRect ? (
        <>
          <div className="onboarding-tour__shade onboarding-tour__shade--top" style={{ height: targetRect.top }} />
          <div className="onboarding-tour__shade onboarding-tour__shade--left" style={{ top: targetRect.top, width: targetRect.left, height: targetRect.bottom - targetRect.top }} />
          <div className="onboarding-tour__shade onboarding-tour__shade--right" style={{ top: targetRect.top, left: targetRect.right, height: targetRect.bottom - targetRect.top }} />
          <div className="onboarding-tour__shade onboarding-tour__shade--bottom" style={{ top: targetRect.bottom }} />
          {!step.interactiveTarget && <div className="onboarding-tour__target-blocker" style={rectStyle} />}
          <div className="onboarding-tour__spotlight" style={rectStyle} aria-hidden="true" />
        </>
      ) : <div className="onboarding-tour__shade onboarding-tour__shade--full" />}
      <section
        ref={dialogRef}
        className={isIntro ? "onboarding-tour__card onboarding-tour__card--intro" : "onboarding-tour__card"}
        style={cardLayout}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        tabIndex={-1}
      >
        {isIntro ? (
          <div className="onboarding-intro">
            <div className="onboarding-intro__copy">
              <img className="onboarding-intro__brand" src={`${import.meta.env.BASE_URL}logo-alpha.png`} alt="" />
              <div>
                <h2 id="onboarding-title">{step.title}</h2>
                <p id="onboarding-description">{step.body}</p>
              </div>
              <div className="onboarding-intro__features">
                {step.features.map(([label, description]) => (
                  <div className="onboarding-intro__feature" key={label}>
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={`onboarding-demo onboarding-demo--${demoDirection}`}>
              <span className="onboarding-demo__eyebrow">{step.demo.eyebrow}</span>
              <div className="onboarding-demo__gauges" aria-hidden="true"><i /><i /><i /><i /></div>
              <div className="onboarding-demo__stage">
                <div className="onboarding-demo__card" aria-live="polite">
                  <img src={`${import.meta.env.BASE_URL}logo-alpha.png`} alt="" />
                  <p>{step.demo.card}</p>
                </div>
              </div>
              <div className="onboarding-demo__choices">
                <button type="button" className={demoDirection === "left" ? "is-active" : ""} onClick={() => setDemoDirection("left")}>← {step.demo.left}</button>
                <button type="button" className={demoDirection === "right" ? "is-active" : ""} onClick={() => setDemoDirection("right")}>{step.demo.right} →</button>
              </div>
              <small>{step.demo.hint}</small>
            </div>
          </div>
        ) : (
          <div className="onboarding-tour__message">
            <h2 id="onboarding-title">{step.title}</h2>
            <p id="onboarding-description">{step.body}</p>
            {step.actionHref && <a className="onboarding-tour__inline-link" href={step.actionHref} target="_blank" rel="noreferrer">{step.actionLabel} <span aria-hidden="true">↗</span></a>}
          </div>
        )}
        <div className="onboarding-tour__actions">
          <span className="onboarding-tour__progress" aria-live="polite">{copy.progress(stepIndex + 1, steps.length)}</span>
          <button className="onboarding-tour__skip" type="button" onClick={onSkip}>{copy.skip}</button>
          <span className="onboarding-tour__nav">
            <button type="button" disabled={stepIndex === 0} onClick={() => onStepChange(stepIndex - 1)} aria-label={copy.back}>←</button>
            <button type="button" onClick={() => isLast ? onFinish() : onStepChange(stepIndex + 1)} aria-label={isLast ? copy.finish : copy.next}>→</button>
          </span>
        </div>
      </section>
    </div>
  );
}
