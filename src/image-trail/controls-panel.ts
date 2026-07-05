// Live controls panel for the grid-window mask-layer.
// Injects a collapsible sidebar with sliders that mutate gridConfig in place —
// mask-layer.ts reads the config per-frame so changes apply instantly.

import { gridConfig } from "./grid-config.ts";

const CSS = `
:root {
  --cp-bg:      #0c0c0e;
  --cp-panel:   #111214;
  --cp-line:    #2a2c30;
  --cp-text:    #d8dadd;
  --cp-dim:     #6a6d72;
  --cp-accent:  #e8e8e8;
  --cp-mono:    ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace;
  --cp-w:       262px;
}

#cp-toggle {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 9999;
  background: var(--cp-panel);
  border: 1px solid var(--cp-line);
  color: var(--cp-text);
  font-family: var(--cp-mono);
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  padding: 7px 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
#cp-toggle:hover { border-color: var(--cp-accent); color: #fff; }

#cp-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: var(--cp-w);
  height: 100vh;
  z-index: 9998;
  background: var(--cp-panel);
  border-left: 1px solid var(--cp-line);
  overflow-y: auto;
  padding: 16px 16px 32px;
  box-sizing: border-box;
  font-family: var(--cp-mono);
  color: var(--cp-text);
  font-size: 11px;
  transform: translateX(0);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  scrollbar-width: thin;
  scrollbar-color: #2c2e32 transparent;
}
#cp-panel.cp-hidden {
  transform: translateX(calc(var(--cp-w) + 2px));
}

.cp-title {
  font-size: 10px;
  letter-spacing: 1.8px;
  color: var(--cp-accent);
  text-transform: uppercase;
  margin-bottom: 2px;
}
.cp-sub {
  font-size: 9px;
  color: var(--cp-dim);
  letter-spacing: 0.5px;
  margin-bottom: 20px;
}

.cp-section {
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--cp-line);
}
.cp-section:last-of-type { border-bottom: none; }

.cp-section-label {
  font-size: 9px;
  color: var(--cp-dim);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.cp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  gap: 8px;
}
.cp-row label {
  font-size: 10px;
  color: var(--cp-text);
  flex: 1;
  white-space: nowrap;
}
.cp-row .cp-val {
  font-size: 9px;
  color: var(--cp-dim);
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

input[type=range].cp-slider {
  -webkit-appearance: none;
  flex: 1.5;
  height: 2px;
  background: var(--cp-line);
  outline: none;
  cursor: pointer;
}
input[type=range].cp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  background: var(--cp-accent);
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.1s;
}
input[type=range].cp-slider:hover::-webkit-slider-thumb { background: #fff; }

.cp-reset {
  display: block;
  width: 100%;
  padding: 9px;
  background: transparent;
  border: 1px solid var(--cp-line);
  color: var(--cp-dim);
  font-family: var(--cp-mono);
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  cursor: pointer;
  text-align: center;
  margin-top: 6px;
  transition: border-color 0.15s, color 0.15s;
}
.cp-reset:hover { border-color: var(--cp-accent); color: var(--cp-text); }
`;

interface SliderSpec {
  label: string;
  key: keyof typeof gridConfig;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}

const SECTIONS: { title: string; rows: SliderSpec[] }[] = [
  {
    title: "Grid",
    rows: [
      { label: "Cell size (px)",    key: "gridCellPx",    min: 16, max: 80,  step: 2,    fmt: v => `${v}px` },
      { label: "Line opacity",      key: "gridLineAlpha", min: 0,  max: 0.4, step: 0.01, fmt: v => `${Math.round(v*100)}%` },
    ],
  },
  {
    title: "Code field",
    rows: [
      { label: "ASCII share",       key: "asciiShare",    min: 0,   max: 1,  step: 0.01, fmt: v => `${Math.round(v*100)}%` },
    ],
  },
  {
    title: "Cursor scan",
    rows: [
      { label: "Reveal radius",     key: "revealRadius",  min: 0.5, max: 6,  step: 0.1,  fmt: v => `${v.toFixed(1)} cells` },
      { label: "Label radius",      key: "asciiRadius",   min: 0.3, max: 5,  step: 0.1,  fmt: v => `${v.toFixed(1)} cells` },
      { label: "Glitch radius",     key: "glitchRadius",  min: 0.5, max: 8,  step: 0.1,  fmt: v => `${v.toFixed(1)} cells` },
    ],
  },
  {
    title: "Glitch",
    rows: [
      { label: "Chance",            key: "glitchChance",  min: 0,   max: 1,  step: 0.01, fmt: v => `${Math.round(v*100)}%` },
      { label: "Displacement",      key: "glitchAmt",     min: 0,   max: 1,  step: 0.01, fmt: v => `${Math.round(v*100)}%` },
      { label: "Speed",             key: "glitchSpeed",   min: 0.1, max: 4,  step: 0.1,  fmt: v => `${v.toFixed(1)} z/s` },
    ],
  },
  {
    title: "Style",
    rows: [
      { label: "Base darken",       key: "baseDarken",    min: 0,   max: 0.8, step: 0.01, fmt: v => `${Math.round(v*100)}%` },
      { label: "Label opacity",     key: "labelAlpha",    min: 0,   max: 1,   step: 0.01, fmt: v => `${Math.round(v*100)}%` },
    ],
  },
];

const DEFAULTS = { ...gridConfig };

export function setupControlsPanel(): void {
  // Inject styles.
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // Toggle button.
  const btn = document.createElement("button");
  btn.id = "cp-toggle";
  btn.textContent = "Controls";
  document.body.appendChild(btn);

  // Panel.
  const panel = document.createElement("div");
  panel.id = "cp-panel";
  panel.classList.add("cp-hidden");

  const title = document.createElement("div");
  title.className = "cp-title";
  title.textContent = "Grid Window";
  panel.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "cp-sub";
  sub.textContent = "mask-layer · live config";
  panel.appendChild(sub);

  // Build sections.
  for (const section of SECTIONS) {
    const sec = document.createElement("div");
    sec.className = "cp-section";

    const lbl = document.createElement("div");
    lbl.className = "cp-section-label";
    lbl.textContent = section.title;
    sec.appendChild(lbl);

    for (const spec of section.rows) {
      const row = document.createElement("div");
      row.className = "cp-row";

      const label = document.createElement("label");
      label.textContent = spec.label;

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "cp-slider";
      slider.min = String(spec.min);
      slider.max = String(spec.max);
      slider.step = String(spec.step);
      slider.value = String(gridConfig[spec.key]);

      const valEl = document.createElement("span");
      valEl.className = "cp-val";
      const fmt = spec.fmt ?? ((v: number) => String(v));
      valEl.textContent = fmt(gridConfig[spec.key] as number);

      slider.addEventListener("input", () => {
        const v = parseFloat(slider.value);
        (gridConfig as unknown as Record<string, number>)[spec.key] = v;
        valEl.textContent = fmt(v);
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valEl);
      sec.appendChild(row);
    }

    panel.appendChild(sec);
  }

  // Reset button.
  const resetSec = document.createElement("div");
  resetSec.className = "cp-section";
  const resetBtn = document.createElement("button");
  resetBtn.className = "cp-reset";
  resetBtn.textContent = "↺ Reset defaults";
  resetBtn.addEventListener("click", () => {
    Object.assign(gridConfig, DEFAULTS);
    // Refresh all slider values.
    panel.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((sl, i) => {
      const flat = SECTIONS.flatMap(s => s.rows);
      const spec = flat[i];
      if (!spec) return;
      sl.value = String(gridConfig[spec.key]);
      const valEl = sl.nextElementSibling as HTMLElement;
      if (valEl) valEl.textContent = (spec.fmt ?? String)(gridConfig[spec.key] as number);
    });
  });
  resetSec.appendChild(resetBtn);
  panel.appendChild(resetSec);

  document.body.appendChild(panel);

  // Toggle visibility.
  let open = false;
  btn.addEventListener("click", () => {
    open = !open;
    panel.classList.toggle("cp-hidden", !open);
    btn.textContent = open ? "Close" : "Controls";
  });
}
