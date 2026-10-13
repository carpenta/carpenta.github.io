# Rendering dependencies

Runtime libraries are pinned in package-lock.json and bundled locally; the app uses no runtime CDN.

| Format / purpose | Library | Upstream | License |
| --- | --- | --- | --- |
| HWP/HWPX | @rhwp/core 0.8.7 | https://github.com/edwardkim/rhwp | MIT |
| PPTX | @office-kit/pptx 0.23.0 + @office-kit/pptx-preview 0.14.0 | https://github.com/office-kit/pptx | MIT |
| DOCX | docx-preview 0.4.1 | https://github.com/VolodymyrBaydalka/docxjs | Apache-2.0 |
| XLSX | SheetJS CE 0.20.3 official tarball | https://docs.sheetjs.com/docs/getting-started/installation/nodejs/ | Apache-2.0 |
| Output sanitation | DOMPurify 3.4.16 | https://github.com/cure53/DOMPurify | Apache-2.0 OR MPL-2.0 |
| Formula calculation | fast-formula-parser 1.0.19 | https://github.com/LesterLyu/fast-formula-parser | MIT |
| PDF output | jsPDF 4.2.1 | https://github.com/parallax/jsPDF | MIT |
| HTML rasterization | html2canvas 1.4.1 | https://github.com/niklasvh/html2canvas | MIT |
| ZIP | fflate 0.8.3 | https://github.com/101arrowz/fflate | MIT |

PPTX preview explicitly uses the SVG text path, since foreignObject is removed by the output sanitizer. RHWP HwpViewer takes ownership of HwpDocument; do not free the transferred document again. Text measurement callback order is `(font, text)`. DOCX uses renderAltChunks:false and useBase64URL:true. SheetJS is sourced from its official release tarball rather than the stale npm xlsx release.
