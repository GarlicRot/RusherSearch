const API_URL = "https://rusherdevelopment.github.io/rusherhack-plugins/api/v1/index.json";

let data = [];

async function fetchData() {
  const res = await fetch(API_URL);
  data = await res.json();
}

function search(query) {
  const results = document.getElementById("results");
  results.innerHTML = "";

  if (!query) return;

  const q = query.toLowerCase();
  const matches = data.filter(
    item =>
      item.name.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q))
  );

  if (matches.length === 0) {
    results.innerHTML = "<li>No results found.</li>";
    return;
  }

  matches.forEach(item => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${item.name}</strong><br>
      <span>${item.description || ""}</span><br>
      <a href="${item.repo}" target="_blank">Repo</a>
    `;
    results.appendChild(li);
  });
}

document.getElementById("search").addEventListener("input", e => {
  search(e.target.value);
});

fetchData();
