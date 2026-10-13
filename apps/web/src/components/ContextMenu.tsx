import { reverseLabel } from "../lib/api";
import { useStore } from "../state/store";

export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const setOrigin = useStore((s) => s.setOrigin);
  const replan = useStore((s) => s.replan);
  const plan = useStore((s) => s.plan);
  const toast = useStore((s) => s.toast);
  if (!menu) return null;

  const startHere = () => {
    setOrigin(menu.lat, menu.lon, "map");
    if (plan) void replan({});
    else toast("Start moved. Your plan will begin here.");
  };

  const whatIsHere = async () => {
    setContextMenu(null);
    const label = await reverseLabel(menu.lat, menu.lon).catch(() => null);
    toast(label ? `That is ${label}.` : "No name for that spot.");
  };

  const style = { left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 120) };
  return (
    <div className="ctx" style={style} role="menu">
      <button type="button" role="menuitem" onClick={startHere}>
        Start the plan here
      </button>
      <button type="button" role="menuitem" onClick={() => void whatIsHere()}>
        What is here?
      </button>
      <span className="ctx__coords">
        {menu.lat.toFixed(4)}, {menu.lon.toFixed(4)}
      </span>
    </div>
  );
}
