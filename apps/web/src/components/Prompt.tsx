import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { REDUCED_MOTION } from "../map/camera";
import { useStore } from "../state/store";

const FALLBACK_EXAMPLES = [
  "First date tonight at 7, dinner then a walk with a view, nothing loud",
  "Three hours of deep work somewhere with wifi, then a short walk to reset",
  "New in town with the whole afternoon, show me what this city is about",
  "Two kids under ten, a playground, lunch nearby and an ice cream",
];

/** Types example wishes into the empty prompt, one character at a time, until the person starts writing. */
function useTypewriter(examples: string[], active: boolean): string {
  const [text, setText] = useState(examples[0] ?? "");
  useEffect(() => {
    if (!active || REDUCED_MOTION || examples.length === 0) {
      setText(examples[0] ?? "");
      return;
    }
    let index = Math.floor(Math.random() * examples.length);
    let chars = 0;
    let deleting = false;
    let timer = 0;
    const step = () => {
      const target = examples[index];
      if (!deleting) {
        chars = Math.min(target.length, chars + 1);
        setText(target.slice(0, chars));
        if (chars === target.length) {
          deleting = true;
          timer = window.setTimeout(step, 2600);
          return;
        }
        timer = window.setTimeout(step, 28 + Math.random() * 40);
      } else {
        chars = Math.max(0, chars - 3);
        setText(target.slice(0, chars));
        if (chars === 0) {
          deleting = false;
          index = (index + 1) % examples.length;
          timer = window.setTimeout(step, 500);
          return;
        }
        timer = window.setTimeout(step, 18);
      }
    };
    timer = window.setTimeout(step, 700);
    return () => window.clearTimeout(timer);
  }, [examples, active]);
  return text;
}

export function Prompt({ compact = false }: { compact?: boolean }) {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const compose = useStore((s) => s.compose);
  const status = useStore((s) => s.status);
  const meta = useStore((s) => s.meta);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [seed] = useState(() => Math.floor(Math.random() * 1000));
  const busy = status === "planning" || status === "locating";

  const examples = useMemo(() => {
    if (!meta) return [];
    const moods = [...meta.moods];
    const picked: typeof moods = [];
    let cursor = seed % moods.length;
    while (picked.length < Math.min(4, moods.length)) {
      picked.push(moods[cursor]);
      cursor = (cursor + 3) % moods.length;
    }
    return picked;
  }, [meta, seed]);

  const allExamples = useMemo(() => (meta ? meta.moods.map((m) => m.example) : FALLBACK_EXAMPLES), [meta]);
  const typed = useTypewriter(allExamples, !compact && query.length === 0 && !busy);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [query, compact]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if ((event.key === "/" && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy) void compose();
    }
    if (event.key === "Tab" && query.length === 0 && typed) {
      event.preventDefault();
      setQuery(typed);
    }
  };

  return (
    <div className={`prompt ${compact ? "prompt--compact" : ""}`}>
      <form
        className="prompt__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void compose();
        }}
      >
        <textarea
          ref={textareaRef}
          className="prompt__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={compact ? "Change the wish and compose again" : typed || "Say it the way you'd say it to a friend who knows the city"}
          rows={1}
          maxLength={300}
          disabled={busy}
          aria-label="What do you want from the next few hours?"
          autoFocus={!compact}
        />
        <div className="prompt__row">
          <button type="submit" className="button button--primary prompt__submit" disabled={busy || query.trim().length < 3}>
            {busy ? "Composing" : compact ? "Recompose" : "Compose the plan"}
          </button>
          {!compact && query.length === 0 && <span className="prompt__hint">Tab uses the example. Enter composes.</span>}
        </div>
      </form>
      {!compact && !busy && examples.length > 0 && (
        <ul className="chips" aria-label="Examples">
          {examples.map((mood) => (
            <li key={mood.key}>
              <button type="button" className="chip" onClick={() => void compose(mood.example)} disabled={busy} title={mood.example}>
                <span className="chip__mood">{mood.label}</span>
                <span className="chip__text">{mood.example}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
