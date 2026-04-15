import { state as BoardState } from "./board_page_state.js";

function showRecentBoards() {
  const parent = document.getElementById("recent-boards");
  if (!parent) return;
  const ul = document.querySelector("#recent-boards ul");
  ul && parent.removeChild(ul);
  parent.classList.add("hidden");

  const storedBoardsText = localStorage.getItem("recent-boards");
  const recentBoards = BoardState.normalizeRecentBoards(
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

window.addEventListener("pageshow", showRecentBoards);
