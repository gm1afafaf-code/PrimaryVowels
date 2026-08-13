(() => {
  const header = document.querySelector("[data-header]");
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  const year = document.querySelector("[data-year]");

  if (year) year.textContent = String(new Date().getFullYear());

  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("nav-open", open);
    });
    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
      });
    });
  }

  document.querySelectorAll("[data-accordion]").forEach((item) => {
    const button = item.querySelector("button");
    const panel = item.querySelector("[data-accordion-panel]");
    if (!button || !panel) return;
    button.addEventListener("click", () => {
      const open = item.classList.toggle("is-open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  const form = document.querySelector("[data-inquire-form]");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      const email = String(data.get("email") || "").trim();
      const interest = String(data.get("interest") || "").trim();
      const quantity = String(data.get("quantity") || "").trim();
      const message = String(data.get("message") || "").trim();
      const note = document.querySelector("[data-form-note]");

      if (!name || !email || !interest) {
        if (note) {
          note.hidden = false;
          note.textContent = "Name, email, and what you need are required.";
        }
        return;
      }

      const body = [
        `Name: ${name}`,
        `Email: ${email}`,
        `Interest: ${interest}`,
        quantity ? `Quantity / config: ${quantity}` : "",
        "",
        message || "(no additional notes)",
      ]
        .filter(Boolean)
        .join("\n");

      const subject = `PrimaryVowels inquiry — ${interest}`;
      window.location.href = `mailto:hello@primaryvowels.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      if (note) {
        note.hidden = false;
        note.textContent = "Your mail client should open with the inquiry drafted. If it doesn’t, write hello@primaryvowels.com directly.";
      }
    });
  }

  document.querySelectorAll("[data-inquire]").forEach((button) => {
    button.addEventListener("click", () => {
      const interest = button.getAttribute("data-inquire");
      const select = document.querySelector("#interest");
      if (select && interest) select.value = interest;
      const qty = document.querySelector("#quantity");
      const hint = button.getAttribute("data-qty");
      if (qty && hint) qty.value = hint;
    });
  });
})();
