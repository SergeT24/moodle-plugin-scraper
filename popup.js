
document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const collectBtns = document.querySelectorAll(".collect");
  const languageSelect = document.getElementById("languageSelect");


  /**
   * Attach events to export buttons.
   * - Detects export type (txt or pdf)
   * - Injects PDF libraries into the active tab if needed
   * - Executes the scraping function in the target page context
   */
  collectBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.id;
      const type = id === "btn-txt" ? "txt" : "pdf";
      statusEl.textContent = i18n[languageSelect.value].extraction_running;

      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0].id;

        try {
          // Inject jsPDF libraries if user selected pfd export
          if (type === "pdf") {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ["libs/jspdf.umd.min.js", "libs/jspdf.plugin.autotable.js"]
            });
          }

          await chrome.scripting.executeScript({
            target: { tabId },
            func: scrapePlugins,
            args: [type, languageSelect.value,i18n]
          });

          statusEl.textContent = i18n[languageSelect.value].extraction_done;
        } catch (err) {
          console.error(err);
          statusEl.textContent = i18n[languageSelect.value].extraction_error;
        }
      });
    });
  });


  // Load saved language (defaults to English)
  chrome.storage.sync.get(["moodle_plugin_scrapper_language"], (result) => {
    let lang = result.moodle_plugin_scrapper_language;

    if (!lang) {
      lang = "en";
      chrome.storage.sync.set({ moodle_plugin_scrapper_language: lang });
    }

    languageSelect.value = lang;
    applyLang(lang);
  });

  // Save selected language
  languageSelect.addEventListener("change", () => {
    const newLang = languageSelect.value;
    chrome.storage.sync.set({ moodle_plugin_scrapper_language: newLang }, () => {
      applyLang(newLang);
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.moodle_plugin_scrapper_language) {
      const newLang = changes.moodle_plugin_scrapper_language.newValue;
      languageSelect.value = newLang;
      applyLang(newLang);
    }
  });


});


/**
 * Main function executed inside the Moodle page context.
 * It scrapes the plugins table and triggers the file download.
 */
function scrapePlugins(type, lang, i18n) {


 /**
   * Triggers a file download directly from the browser.
   * @param {string|Uint8Array|BlobPart[]} content - File content.
   * @param {string} filename - Suggested filename.
   * @param {string} mime - MIME type (e.g. "text/plain" or "application/pdf").
   */
  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


 /**
   * Returns element text only, stripping icons, images, and SVGs.
   * @param {Element|null} el
   * @returns {string}
   */
  function textOnly(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("img,svg,i").forEach(n => n.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Extract current domain from URL.
   */
  function getDomainFromUrl() {
    const url = window.location.href;
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return null;
    }
  }

  /** Convert a string to a safe filename slug*/
  function make_slug(str) {
    str = str.replace(/^\s+|\s+$/g, ''); // trim leading/trailing white space
    str = str.toLowerCase(); // convert string to lowercase
    str = str.replace(/[^a-z0-9 -]/g, '') // remove any non-alphanumeric characters
            .replace(/\s+/g, '-') // replace spaces with hyphens
            .replace(/-+/g, '-'); // remove consecutive hyphens
    return str;
  }

  /** Build a correct export filename with date + domain */
  function make_file_name(extension) {
    const domain = getDomainFromUrl();
    const slug = domain ? make_slug(domain) : "moodle_plugins";
    let filename;

    filename = `plugins_${slug}_${new Date().toISOString().slice(0, 10)}.${extension}`;
    return filename;

  }


  /**
   * Display a toast message both in console and in popup (if possible)
   * @param {string} msg
   * @param {string} color
   */
  function toast(msg,color = "green") {
    try {
      const status = document.getElementById("status");
      status.style.color = color;
      if (status) status.textContent = msg;
    } catch (_) {}
    console.log(msg);
  }


  // Try to locate Moodle plugin rows
  let rows = Array.from(document.querySelectorAll("table.generaltable tbody tr.additional.status-uptodate"));
  if (!rows.length) {
    rows = Array.from(document.querySelectorAll("table.generaltable tbody tr.extension.status-uptodate"));
  }
  if (!rows.length) {
    toast(i18n[lang].nothing_found,"red");
    return;
  }


  // Export TXT 
  if (type === "txt") {
 
    // get text of .componentname columns
    const list = rows.map(tr => {
      const compEl = tr.querySelector(".componentname");
      return compEl ? compEl.textContent.trim() : "";
    }).filter(Boolean);

    if (!list.length) {
      alert(i18n[lang].nothing_found);
      return;
    }
    const filename = make_file_name("txt");
    downloadBlob(list.join("\n"), filename, "text/plain");
    toast(`${list.length} ${i18n[lang].plugins} ${i18n[lang].exported}`);
    return;
  }

  // Export PDF 
  if (type === "pdf") {

    const records = rows.map(tr => {
      const displayDiv = tr.querySelector(".pluginname .displayname");
      const componentEl = tr.querySelector(".pluginname .componentname");
      const releaseEl = tr.querySelector(".version .release");
      const buildEl = tr.querySelector(".version .versionnumber");

      return {
        name: textOnly(displayDiv),
        component: (componentEl?.textContent || "").trim(),
        release: (releaseEl?.textContent || "").trim(),
        versionnumber: (buildEl?.textContent || "").trim()
      };
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const actualURL = window.location.href
    const headers = [
      i18n[lang].headers.name,
      i18n[lang].headers.component,
      i18n[lang].headers.release,
      i18n[lang].headers.versionnumber
    ];
    const body = records.map(r => [r.name || "", r.component || "", r.release || "", r.versionnumber || ""]);

    doc.setFontSize(14); doc.text(i18n[lang].additionnal_plugins, 40, 40);
    doc.setFontSize(10);
    doc.text(`${i18n[lang].generate_on} ${new Date().toLocaleString()} ${i18n[lang].from} ${actualURL}`, 40, 58);
    doc.text(`${records.length} ${i18n[lang].plugins}`, 40, 72);



    // Table styling
    doc.autoTable({
      head: [headers],
      body,
      startY: 90,
      styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: {
        fontStyle: 'bold',
        fillColor: [0, 0, 0],
        textColor: [255, 255, 255]
      },
      theme: "striped"
    });

    const filename = make_file_name("pdf");
    doc.save(filename);
    return;
  }

}

const i18n = {
  fr: {
    title : "Moodle Plugin Scraper",
    description: "Clique sur un bouton pour extraire les plugins additionnels depuis admin/plugins.php",
    languages: "Langues",
    english: "Anglais",
    french: "Français",
    btn_txt: "Version simple [TXT]",
    btn_pdf: "Version avancée [PDF]",
    headers: {
      name: "Nom du plugin",
      component: "Composant",
      release: "Version",
      versionnumber: "Numéro de version"
    },
    additionnal_plugins: "Plugins additionnels",
    plugins: "plugin(s)",
    generate_on: "Généré le",
    from: "depuis",
    nothing_found: "Aucun plugin additionnel trouvé.",
    exported: "exporté(s).",
    extraction_done: "Extraction terminée.",
    extraction_error: "Erreur pendant l'extraction.",
    extraction_running: "Analyse en cours…"

  },
  en: {
    title : "Moodle Plugin Scraper",
    description: "Click a button to extract additional plugins from admin/plugins.php",
    english: "English",
    french: "French",
    languages: "Languages",
    btn_txt: "Simple version [TXT]",
    btn_pdf: "Advanced version [PDF]",
    headers: {
      name: "Plugin Name",
      component: "Component",
      release: "Release",
      versionnumber: "Version Number"
    },
    additionnal_plugins: "Additional Plugins",
    plugins: "plugin(s)",
    generate_on: "Generated on",
    from: "from",
    nothing_found: "No additional plugins found.",
    exported: "exported.",
    extraction_done: "Extraction completed.",
    extraction_error: "Error during extraction.",
    extraction_running: "Analysis in progress…",
  }
};



function applyLang(lang) {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (i18n[lang][key]) {
      el.placeholder = i18n[lang][key];
    }
  });
}

