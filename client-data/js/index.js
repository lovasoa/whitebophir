import { BOARD_NAME_INPUT_PATTERN, sanitizeBoardName } from "./board_name.js";
import { normalizeRecentBoards } from "./board_page_state.js";

function setupNamedBoardForm() {
  const form = document.getElementById("named-board-form");
  const input = document.getElementById("board");
  if (!(form instanceof HTMLFormElement)) return;
  if (!(input instanceof HTMLInputElement)) return;

  input.pattern = BOARD_NAME_INPUT_PATTERN;

  input.addEventListener("input", () => {
    const sanitizedValue = sanitizeBoardName(input.value);
    if (sanitizedValue === input.value) return;

    const selectionStart = input.selectionStart ?? input.value.length;
    const removedCharacters = input.value.length - sanitizedValue.length;
    input.value = sanitizedValue;

    const nextSelection = Math.max(0, selectionStart - removedCharacters);
    input.setSelectionRange(nextSelection, nextSelection);
  });

  form.addEventListener("submit", (event) => {
    input.value = sanitizeBoardName(input.value);
    if (input.value !== "") return;

    event.preventDefault();
    input.reportValidity();
  });
}

function showRecentBoards() {
  const parent = document.getElementById("recent-boards");
  if (!parent) return;
  const ul = document.querySelector("#recent-boards ul");
  ul && parent.removeChild(ul);
  parent.classList.add("hidden");

  const storedBoardsText = localStorage.getItem("recent-boards");
  const recentBoards = normalizeRecentBoards(
    storedBoardsText ? JSON.parse(storedBoardsText) : [],
  );
  if (recentBoards.length === 0) return;

  const list = document.createElement("ul");

  recentBoards.forEach(
    /** @param {string} name */
    (name) => {
      const listItem = document.createElement("li");
      const link = document.createElement("a");
      link.setAttribute("href", `/boards/${encodeURIComponent(name)}`);
      link.textContent = name;
      listItem.appendChild(link);
      list.appendChild(listItem);
    },
  );

  parent.appendChild(list);
  parent.classList.remove("hidden");
}

setupNamedBoardForm();
window.addEventListener("pageshow", showRecentBoards);
