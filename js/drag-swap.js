/*
  drag-swap.js – Ziehen und Ablegen zum Tauschen (Finger oder Maus).

  Aufruf im pointerdown eines Griffs:
    dragSwap(event, { source, targets, onDrop })
      source  = Element, das "gegriffen" wird (eine blasse Kopie folgt dem Finger)
      targets = Elemente, auf die man ablegen darf (das Ziel unter dem Finger leuchtet)
      onDrop(target) wird nach dem Loslassen auf einem Ziel aufgerufen.
  Loslassen woanders oder Abbruch (pointercancel) = nichts passiert.
*/
export function dragSwap(event, { source, targets, onDrop }) {
  event.preventDefault(); // kein Scrollen, kein Kreismenü darunter
  event.stopPropagation();
  const handle = event.currentTarget;
  handle.setPointerCapture?.(event.pointerId); // Finger bleibt beim Griff, auch außerhalb

  const box = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${box.width}px`;
  ghost.style.height = `${box.height}px`;
  document.body.append(ghost);
  source.classList.add("drag-source");
  const offsetX = event.clientX - box.left;
  const offsetY = event.clientY - box.top;
  let target = null;

  const inside = (el, x, y) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const move = (e) => {
    if (e.pointerId !== event.pointerId) return;
    ghost.style.transform = `translate(${e.clientX - offsetX}px, ${e.clientY - offsetY}px)`;
    const hit = targets.find((el) => el !== source && inside(el, e.clientX, e.clientY)) ?? null;
    if (hit === target) return;
    target?.classList.remove("drop-target");
    hit?.classList.add("drop-target");
    target = hit;
  };
  const end = (e) => {
    if (e.pointerId !== event.pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    ghost.remove();
    source.classList.remove("drag-source");
    target?.classList.remove("drop-target");
    if (e.type === "pointerup" && target) onDrop(target);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  move(event);
}
