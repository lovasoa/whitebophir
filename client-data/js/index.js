window.addEventListener("pageshow", () => showRecentBoards());
	
function showRecentBoards() {
  const parent = document.getElementById("recent-boards");
  const ul = document.querySelector("#recent-boards ul");
  ul && parent.removeChild(ul);
  parent.classList.add("hidden");

  const recentBoards = JSON.parse(localStorage.getItem("recent-boards")) || [];

  if (recentBoards.length === 0) return;

  const list = document.createElement("ul");

  recentBoards.forEach(function(name) {
    const listItem = document.createElement("li");
    const link = document.createElement("a");
    link.setAttribute("href", `/boards/${name}`);
    link.textContent = name;
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  parent.appendChild(list);
  parent.classList.remove("hidden");
}
