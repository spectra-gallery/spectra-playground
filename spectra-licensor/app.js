/* Spectra Licensor — app logic */
(function(){
  const $ = (id)=> document.getElementById(id);
  const nowISO = ()=> new Date().toISOString();

  // clock + entropy demo
  const clockEl = $("clock"), entropyEl = $("entropy"), alertsEl = $("alerts");
  setInterval(()=> clockEl.textContent = nowISO(), 1000);

  // Simple entropy estimate of mission (Shannon)
  function strEntropy(s){ if(!s || !s.length) return 0;
    const freq = {}; for(const c of s) freq[c]=(freq[c]||0)+1;
    let e=0; for(const k in freq){ const p=freq[k]/s.length; e-=p*Math.log2(p); } return e;
  }

  // Hash helpers
  async function sha256(text){
    const data = new TextEncoder().encode(text);
    const h = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("");
  }

  // Toxicity / risk heuristics (very light; client-side only)
  const PATTERNS = {
    threats: /\b(kill|violence|attack|destroy|threat|suicide|harm)\b/i,
    hate: /\b(racist|nazi|slur|hate|supremacy)\b/i,
    pii: /\b\d{3,}[-\s]?\d{2,}[-\s]?\d{3,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  };
  function analyzeText(s, opts){
    const out = {
      length: s.length,
      entropy: strEntropy(s),
      checksum: null,
      flags: []
    };
    if (opts.threat && PATTERNS.threats.test(s)) out.flags.push("threat");
    if (opts.hate && PATTERNS.hate.test(s)) out.flags.push("hate");
    if (opts.pii && PATTERNS.pii.test(s)) out.flags.push("pii");
    return sha256(s).then(h=> (out.checksum=h, out));
  }

  // SPDX templates
  const TPL = window.SPECTRA_LICENSES || {};

  // Render manifest preview
  async function preview(){
    const name = $("projName").value || "Spectra";
    const version = $("projVersion").value || "0.1.0";
    const entity = $("projEntity").value || "Uniphilabs";
    const juris = $("projJuris").value || "CH";
    const mission = $("projMission").value || "";
    const domains = $("projDomains").value.split(",").map(s=>s.trim()).filter(Boolean);
    const ca = $("projCA").value;
    const authority = $("projAuthority").value || "";

    const matrix = {
      software: $("licSoftware").value,
      hardware: $("licHardware").value,
      data: $("licData").value,
      art: $("licArt").value,
      ethics: $("dualEthicsSw").checked ? "ETHICAL-CHARTER" : null
    };

    const fingerprint = await sha256([name,version,entity,juris,mission,domains.join("|")].join("\n"));

    const manifest = {
      "$schema":"https://json.schemastore.org/package",
      id: fingerprint.slice(0,12),
      name, version, entity, jurisdiction: juris,
      mission, domains, ca, authority,
      licenses: matrix,
      generatedAt: nowISO()
    };
    $("preview").textContent = JSON.stringify(manifest, null, 2);
    entropyEl.textContent = `entropy: ${strEntropy(mission).toFixed(2)}`;
    return manifest;
  }
  $("btnPreview").onclick = preview;

  // Text analysis
  $("btnAnalyze").onclick = async ()=>{
    const res = await analyzeText(
      $("intentText").value || "",
      {threat: $("toxThreat").checked, hate: $("toxHate").checked, pii: $("toxPii").checked}
    );
    $("intentOut").textContent = JSON.stringify(res,null,2);
    alertsEl.textContent = `alerts: ${res.flags.length}`;
  };

  // Build documents from selections
  function fill(tpl, map){ return (tpl||"").replace(/\{\{(\w+)\}\}/g, (_,k)=> map[k] ?? ""); }

  async function buildFiles(manifest){
    const year = new Date().getFullYear().toString();
    const owner = manifest.entity;
    const files = {};

    // LICENSE stack per artifact
    const licFiles = [
      ["SOFTWARE_LICENSES.md", manifest.licenses.software],
      ["HARDWARE_LICENSES.md", manifest.licenses.hardware],
      ["DATA_LICENSES.md",     manifest.licenses.data],
      ["ART_LICENSES.md",      manifest.licenses.art]
    ];
    for(const [fname, spdx] of licFiles){
      const body = (TPL[spdx] || (spdx+" (template)"));
      files[fname] = `# ${spdx}\n\n` + fill(body, {YEAR: year, OWNER: owner});
    }
    if (manifest.licenses.ethics){
      files["ETHICS.md"] = fill(TPL["ETHICAL-CHARTER"], {YEAR: year, OWNER: owner});
    }

    // Governance
    if (document.getElementById("genGovernance").checked){
      files["GOVERNANCE.md"] = `# Governance\n\n- Steward: ${owner}\n- Jurisdiction: ${manifest.jurisdiction}\n- Decision model: RFC → Lazy consensus → Maintainer vote\n- Transparency: publish minutes, audits, release notes.\n`;
    }
    if (document.getElementById("genSecurity").checked){
      files["SECURITY.md"] = `# Security Policy\n\n- Report at: security@${(manifest.domains[0]||"example.com").replace(/^.*@/,"")}\n- Supported versions: latest two minors\n- Embargo: 90 days\n- Key: (PGP/WKD)\n`;
      files["THREATMODEL.md"] = `# Threat Model (high‑level)\n\n- Actors: users, maintainers, CI, mirrors\n- Assets: supply chain, keys, data, art\n- Risks: typosquatting, dependency confusion, doxxing, harassment\n- Mitigations: Sigstore, SBOM, CoC, 2FA, backups\n`;
    }
    if (document.getElementById("genDCO").checked){
      files["DCO.txt"] = `Developer Certificate of Origin 1.1\n\nBy making a contribution to this project, I certify that:\n(1) The contribution was created by me or I have the right to submit it under the open source license indicated.\n(2) The contribution is made in good faith.\nSigned-off-by: Name <email>\n`;
    }
    if (document.getElementById("genCode").checked){
      files["CODE_OF_CONDUCT.md"] = `# Code of Conduct\n\nWe pledge to make participation a harassment‑free experience for everyone.\n- Be kind. No bigotry. No threats.\n- Resolve conflict with curiosity and data.\n- Consequences: warning → timeout → ban.\n`;
    }

    // Contract (human) — simplified
    files["CONTRACT.md"] = `# Spectra Collaboration Agreement\n\n**Parties:** ${owner} and Contributors.\n**Purpose:** enable open collaboration with continuity, transparency, safety, autonomy.\n\n**License Stack:**\n- Software: ${manifest.licenses.software}\n- Hardware: ${manifest.licenses.hardware}\n- Data: ${manifest.licenses.data}\n- Art/Media: ${manifest.licenses.art}\n\n**Rights:** contributors retain copyright; grant license under stack above.\n**Attribution:** required per license.\n**Safety:** adheres to ETHICS.md and CODE_OF_CONDUCT.md (non‑restrictive guidance).\n**Dispute Resolution:** ${manifest.jurisdiction} courts; arbitration optional.\n`;

    // JSON‑LD manifest
    files["spectra-manifest.json"] = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      "name": manifest.name,
      "version": manifest.version,
      "creator": manifest.entity,
      "license": manifest.licenses,
      "jurisdiction": manifest.jurisdiction,
      "domains": manifest.domains,
      "mission": manifest.mission,
      "generatedAt": manifest.generatedAt
    }, null, 2);

    // Solidity contract
    files["contracts/SpectraLicense.sol"] = await (await fetch("contracts/SpectraLicense.sol")).text().catch(()=> "// include SpectraLicense.sol alongside index.html");

    // README
    files["README.md"] = `# ${manifest.name} — Licensor Bundle\n\n- Generated: ${manifest.generatedAt}\n- Entity: ${owner}\n- Domains: ${manifest.domains.join(", ")}\n\n## How to use\n1. Review LICENSE* files.\n2. Commit the bundle at repo root.\n3. (Optional) Deploy contracts/SpectraLicense.sol with Hardhat & mint license NFTs.\n`;

    return files;
  }

  // Bundle → zip
  async function buildZip(files){
    const zip = new JSZip();
    Object.entries(files).forEach(([path,content])=> zip.file(path, content));
    const blob = await zip.generateAsync({type:"blob"});
    const a = Object.assign(document.createElement("a"), {href:URL.createObjectURL(blob), download:"spectra-licensor-bundle.zip"});
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Wire buttons
  $("btnBundle").onclick = async ()=>{
    const manifest = await preview();
    const files = await buildFiles(manifest);
    await buildZip(files);
  };

  // init
  preview();
})();