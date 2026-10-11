const modeBadge = document.getElementById("modeBadge");
const loginStatus = document.getElementById("loginStatus");
const patientList = document.getElementById("patientList");
const searchResults = document.getElementById("searchResults");
const notesList = document.getElementById("notesList");
const emailStatus = document.getElementById("emailStatus");
const labOutput = document.getElementById("labOutput");
const csrfTokenInput = document.getElementById("csrfToken");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  return response.json();
}

async function loadMode() {
  const health = await fetchJson("/api/health");
  modeBadge.textContent = `Mode: ${health.mode.toUpperCase()}`;
  if (health.mode === "safe") {
    const token = await fetchJson("/api/csrf-token");
    csrfTokenInput.value = token.token;
  }
}

async function loadPatients() {
  const patients = await fetchJson("/api/patients");
  patientList.innerHTML = patients.map((patient) => `
    <div class="list-item">
      <strong>${patient.display_name}</strong><br />
      ${patient.patient_number} · ${patient.date_of_birth}
    </div>
  `).join("") || "<div class='list-item'>No patients found.</div>";
}

async function loadNotes() {
  const notes = await fetchJson("/api/notes");
  notesList.innerHTML = notes.map((note) => `
    <div class="list-item">
      <strong>${note.patient_name}</strong><br />
      ${note.body}
    </div>
  `).join("") || "<div class='list-item'>No notes yet.</div>";
}

async function runSearch(event) {
  event.preventDefault();
  const query = document.getElementById("searchQuery").value;
  const result = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
  searchResults.innerHTML = result.results.length
    ? result.results.map((row) => `
        <div class="list-item">
          <strong>${row.patient_name}</strong><br />
          ${row.body}
        </div>
      `).join("")
    : "<div class='list-item'>No matches found.</div>";
}

async function submitLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await fetchJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!result.success) {
      loginStatus.textContent = result.error;
      loginStatus.style.color = "crimson";
      return;
    }

    loginStatus.textContent = `Logged in as ${result.user.username} (${result.user.role})`;
    loginStatus.style.color = "green";
  } catch (error) {
    loginStatus.textContent = "Login failed.";
    loginStatus.style.color = "crimson";
  }
}

async function saveNote(event) {
  event.preventDefault();
  const text = document.getElementById("noteText").value;

  const result = await fetchJson("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (result.success) {
    await loadNotes();
  }
}

async function updateEmail(event) {
  event.preventDefault();
  const email = document.getElementById("emailInput").value;
  const token = csrfTokenInput.value;

  const result = await fetchJson("/api/change-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, _csrf: token })
  });

  if (result.success) {
    emailStatus.textContent = `Email updated to ${result.email}`;
    emailStatus.style.color = "green";
  } else {
    emailStatus.textContent = result.error || "Update failed.";
    emailStatus.style.color = "crimson";
  }
}

async function runDemo(kind) {
  if (kind === "easy") {
    const payload = "' OR '1'='1";
    const response = await fetchJson(`/api/sql-easy?username=${encodeURIComponent(payload)}`);
    labOutput.textContent = JSON.stringify(response, null, 2);
    return;
  }

  if (kind === "intermediate") {
    const payload = "%' AND SUBSTR((SELECT username FROM users LIMIT 1),1,1)='a' --";
    const response = await fetchJson(`/api/sql-intermediate?name=${encodeURIComponent(payload)}`);
    labOutput.textContent = JSON.stringify(response, null, 2);
    return;
  }

  const response = await fetchJson("/api/sql-advanced?stage=tables");
  labOutput.textContent = JSON.stringify(response, null, 2);
}

document.getElementById("loginForm").addEventListener("submit", submitLogin);
document.getElementById("searchForm").addEventListener("submit", runSearch);
document.getElementById("noteForm").addEventListener("submit", saveNote);
document.getElementById("emailForm").addEventListener("submit", updateEmail);
document.querySelectorAll(".lab-btn").forEach((button) => {
  button.addEventListener("click", () => runDemo(button.dataset.demo));
});

loadMode();
loadPatients();
loadNotes();
