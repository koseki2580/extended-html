const examplesRoot = new URL("../", import.meta.url);
const page = document.body.dataset.page;

const links = [
  { id: "overview", label: "Overview", path: "" },
  { id: "web-socket-main", label: "WebSocket: Main", path: "web-socket/" },
  {
    id: "web-socket-worker",
    label: "WebSocket: Worker",
    path: "web-socket/background.html",
  },
];

const sidebar = document.querySelector("[data-site-sidebar]");
if (sidebar) {
  const navigation = document.createElement("nav");
  navigation.className = "site-navigation";
  navigation.setAttribute("aria-label", "Examples");

  const brand = document.createElement("a");
  brand.className = "site-brand";
  brand.href = examplesRoot.href;
  brand.innerHTML = `<span class="brand-mark" aria-hidden="true">&lt;/&gt;</span>
    <span><strong>extended-html</strong><small>Live examples</small></span>`;
  navigation.append(brand);

  const list = document.createElement("ul");
  list.className = "navigation-list";
  for (const link of links) {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = new URL(link.path, examplesRoot).href;
    anchor.textContent = link.label;
    if (link.id === page) {
      anchor.className = "is-active";
      anchor.setAttribute("aria-current", "page");
    }
    item.append(anchor);
    list.append(item);
  }
  navigation.append(list);

  const footer = document.createElement("p");
  footer.className = "sidebar-footer";
  footer.textContent = "Standard JavaScript · No build step";
  navigation.append(footer);
  sidebar.append(navigation);
}
