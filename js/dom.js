/*
  dom.js – kleine Helfer, um Bildschirme per JavaScript zu bauen.

  Statt HTML als Text zusammenzusetzen, erzeugen wir Elemente mit el(...).
  Vorteil: Namen, die jemand eingibt, werden immer als reiner Text eingefügt
  und nie als HTML ausgeführt. Das schützt vor einer typischen Sicherheitslücke.

  Beispiel:
    el("button", { class: "btn", onClick: () => alert("hi") }, "Klick mich")
  ergibt: <button class="btn">Klick mich</button> mit Klick-Funktion.
*/

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) {
      // onClick -> addEventListener("click", ...)
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      node.className = value;
    } else if (key in node) {
      node[key] = value; // z. B. value, type, hidden, maxLength
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/*
  Knopf zum Löschen mit Sicherheitsabfrage ohne Popup:
  1. Klick: Knopf wird rot und fragt "Wirklich?"
  2. Klick innerhalb von 3 Sekunden: Aktion wird ausgeführt.
  Sonst springt der Knopf zurück.
*/
export function confirmButton(label, confirmLabel, onConfirm) {
  let armed = false;
  let timer = null;
  const button = el("button", {
    type: "button",
    class: "btn",
    onClick: () => {
      if (armed) {
        clearTimeout(timer);
        onConfirm();
        return;
      }
      armed = true;
      button.textContent = confirmLabel;
      button.classList.add("btn-danger");
      timer = setTimeout(() => {
        armed = false;
        button.textContent = label;
        button.classList.remove("btn-danger");
      }, 3000);
    },
  }, label);
  return button;
}

// Zeigt eine Fehlermeldung in einem <p class="form-error"> an (leer = ausblenden).
export function showError(paragraph, message) {
  paragraph.textContent = message ?? "";
  paragraph.hidden = !message;
}
