import { normalizeRecentBoards } from "./board_page_state.mjs";

function showRecentBoards() {
  const parent = document.getElementById("recent-boards");
  if (!parent) return;
  const ul = document.querySelector("#recent-boards ul");
  if (ul) parent.removeChild(ul);
  parent.classList.add("hidden");

  const storedBoardsText = localStorage.getItem("recent-boards");
  const recentBoards = normalizeRecentBoards(
    storedBoardsText ? JSON.parse(storedBoardsText) : [],
  );
  if (recentBoards.length === 0) return;

  const list = document.createElement("ul");

  recentBoards.forEach((name) => {
    const listItem = document.createElement("li");
    const link = document.createElement("a");
    link.setAttribute("href", `/boards/${encodeURIComponent(name)}`);
    link.textContent = name;
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  parent.appendChild(list);
  parent.classList.remove("hidden");
}

window.addEventListener("pageshow", showRecentBoards);
// Also call it immediately since we are in a module
showRecentBoards();
