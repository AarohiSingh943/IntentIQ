import { useEffect } from "react";
import { MapTools, Toasts, TopBar } from "./components/Chrome";
import { ContextMenu } from "./components/ContextMenu";
import { Panel } from "./components/Panel";
import { ShareSheet } from "./components/ShareSheet";
import { Timeline } from "./components/Timeline";
import { MapScene } from "./map/MapScene";
import { useStore } from "./state/store";

export default function App() {
  const loadMeta = useStore((s) => s.loadMeta);
  const openShared = useStore((s) => s.openShared);
  const selectStop = useStore((s) => s.selectStop);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const hasPlan = useStore((s) => s.plan !== null);

  useEffect(() => {
    void loadMeta();
    const match = window.location.pathname.match(/^\/p\/([a-z0-9]{6,12})$/);
    if (match) void openShared(match[1]);
  }, [loadMeta, openShared]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        selectStop(null);
        setContextMenu(null);
      }
      if (event.key === " " && hasPlan && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement) && !(document.activeElement instanceof HTMLButtonElement)) {
        event.preventDefault();
        const store = useStore.getState();
        store.setPlayback({ playing: !store.playback.playing, follow: true });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectStop, setContextMenu, hasPlan]);

  return (
    <div className="app">
      <MapScene />
      <TopBar />
      <Panel />
      <Timeline />
      <MapTools />
      <ContextMenu />
      <ShareSheet />
      <Toasts />
    </div>
  );
}
