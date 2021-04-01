function showRecentBoards() {
  var parent = document.getElementById("recent-boards");
  var ul = document.querySelector("#recent-boards ul");
  ul && parent.removeChild(ul);
  parent.classList.add("hidden");

  var recentBoards = JSON.parse(localStorage.getItem("recent-boards")) || [];
  if (recentBoards.length === 0) return;

  var list = document.createElement("ul");

  recentBoards.forEach(function(name) {
    var listItem = document.createElement("li");
    var link = document.createElement("a");
    link.setAttribute("href", `/boards/${encodeURIComponent(name)}`);
    link.textContent = name;
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  parent.appendChild(list);
  parent.classList.remove("hidden");
}

window.addEventListener("pageshow", showRecentBoards);