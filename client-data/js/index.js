import { state as BoardState } from "./board_page_state.js";

function showRecentBoards() {
  var parent = document.getElementById("recent-boards");
  if (!parent) return;
  var ul = document.querySelector("#recent-boards ul");
  ul && parent.removeChild(ul);
  parent.classList.add("hidden");

  var storedBoardsText = localStorage.getItem("recent-boards");
  var recentBoards = BoardState.normalizeRecentBoards(
    storedBoardsText ? JSON.parse(storedBoardsText) : [],
  );
  if (recentBoards.length === 0) return;

  var list = document.createElement("ul");

  recentBoards.forEach(
    /** @param {string} name */
    function (name) {
      var listItem = document.createElement("li");
      var link = document.createElement("a");
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
