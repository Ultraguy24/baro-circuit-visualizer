let globalItemMap = {};
let currentTransform = { x: 0, y: 0, zoom: 1 };
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };
let activeBoxId = null;

// Parsed save state
let parsedSubs = [];      // [{ name, xmlText }]
let activeSubName = null; // from <Gamesession submarine="...">
let currentXmlDoc = null;

const WIRE_COLORS = {
    "wire": "#cbd5e1",
    "blackwire": "#475569",
    "bluewire": "#3b82f6",
    "brownwire": "#b45309",
    "greenwire": "#10b981",
    "orangewire": "#f97316",
    "redwire": "#ef4444"
};

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const circuitList = document.getElementById('circuitList');
const svgContainer = document.getElementById('svgContainer');
const status = document.getElementById('status');
const subSelectWrapper = document.getElementById('subSelectWrapper');
const subSelect = document.getElementById('subSelect');

// --- File Handling ---
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('active'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('active'));
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
    if (!file) return;
    updateStatus(`Loading ${file.name}...`);
    subSelectWrapper.style.display = 'none';
    circuitList.innerHTML = '<li class="placeholder">No boxes loaded</li>';
    svgContainer.innerHTML = '';
    parsedSubs = [];
    activeSubName = null;

    try {
        const buffer = new Uint8Array(await file.arrayBuffer());

        if (buffer[0] === 0x1F && buffer[1] === 0x8B) {
            // Outer gzip — decompress and inspect
            const decompressed = pako.ungzip(buffer);
            const preview = new TextDecoder().decode(decompressed.slice(0, 64));

            if (preview.includes('<Submarine')) {
                // Standalone gzipped .sub
                loadSingleSub(new TextDecoder().decode(decompressed), file.name);
            } else {
                // .save archive: outer gzip wrapping a binary archive of named files
                parseSaveArchive(decompressed, file.name);
            }
        } else {
            // Raw XML .sub
            loadSingleSub(new TextDecoder().decode(buffer), file.name);
        }

    } catch (err) {
        console.error(err);
        updateStatus(err.message, true);
    }
}

// --- .save Archive Parser ---
// After the outer gzip is removed, the data is a sequence of entries:
//   [int32 LE]  filename character count (UTF-16LE chars, not bytes)
//   [UTF-16LE]  filename  e.g. "gamesession.xml", "Orca2.sub"
//   [int32 LE]  content byte length
//   [bytes]     content
//     gamesession.xml -> raw UTF-8 XML (may have BOM), contains submarine="Name"
//     *.sub           -> gzip-compressed submarine XML

function parseSaveArchive(data, filename) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = 0;
    const entries = {};

    while (pos + 8 <= data.length) {
        const nameCharCount = view.getInt32(pos, true);
        pos += 4;
        if (nameCharCount <= 0 || nameCharCount > 512) break;
        if (pos + nameCharCount * 2 > data.length) break;

        const entryName = new TextDecoder('utf-16le').decode(data.slice(pos, pos + nameCharCount * 2));
        pos += nameCharCount * 2;

        if (pos + 4 > data.length) break;
        const contentLen = view.getInt32(pos, true);
        pos += 4;
        if (contentLen < 0 || pos + contentLen > data.length) break;

        entries[entryName] = data.slice(pos, pos + contentLen);
        pos += contentLen;
    }

    // Read active sub name from gamesession.xml
    if (entries['gamesession.xml']) {
        const gsText = new TextDecoder('utf-8').decode(entries['gamesession.xml']);
        const match = gsText.match(/\bsubmarine="([^"]+)"/);
        activeSubName = match ? match[1] : null;
    }

    // Decompress each .sub entry
    parsedSubs = [];
    for (const [entryName, content] of Object.entries(entries)) {
        if (!entryName.endsWith('.sub')) continue;
        try {
            const xmlText = pako.ungzip(content, { to: 'string' });
            // Use the filename as the sub name (e.g. "Orca2.sub" -> "Orca2")
            // This is reliable and avoids scanning the XML for a name attribute
            const subName = entryName.replace(/\.sub$/i, '');
            parsedSubs.push({ name: subName, xmlText });
        } catch (e) {
            console.warn(`Failed to decompress ${entryName}:`, e);
        }
    }

    if (parsedSubs.length === 0) {
        throw new Error('No submarine data found in this save file.');
    }

    // Build dropdown, mark the active sub with a star
    subSelect.innerHTML = '';
    parsedSubs.forEach((sub, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        const isActive = activeSubName && sub.name === activeSubName;
        opt.textContent = isActive ? `${sub.name} ★` : sub.name;
        if (isActive) opt.selected = true;
        subSelect.appendChild(opt);
    });
    subSelectWrapper.style.display = 'block';

    // Auto-load the active sub, falling back to index 0
    const activeIdx = parsedSubs.findIndex(s => s.name === activeSubName);
    loadSelectedSub(activeIdx >= 0 ? activeIdx : 0);
}

// --- Single .sub (no dropdown) ---
function loadSingleSub(xmlText, filename) {
    currentXmlDoc = parseXml(xmlText);
    subSelectWrapper.style.display = 'none';
    processSubmarine();
    updateStatus(`Loaded: ${filename}`);
}

// --- Dropdown ---
subSelect.addEventListener('change', () => loadSelectedSub(parseInt(subSelect.value)));

function loadSelectedSub(idx) {
    const sub = parsedSubs[idx];
    if (!sub) return;
    try {
        currentXmlDoc = parseXml(sub.xmlText);
        processSubmarine();
        const isActive = activeSubName && sub.name === activeSubName;
        updateStatus(`${sub.name}${isActive ? ' (active)' : ''}`);
    } catch (err) {
        console.error(err);
        updateStatus(err.message, true);
    }
}

// --- XML Parsing ---
function parseXml(xmlText) {
    const clean = sanitizeXml(xmlText);
    const parser = new DOMParser();
    const doc = parser.parseFromString(clean, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML parse error — file may be corrupted.');
    return doc;
}

function sanitizeXml(s) {
    // Strip UTF-8 BOM and control characters
    let clean = s.replace(/^\uFEFF/, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    const start = clean.indexOf('<');
    if (start === -1) return '';
    clean = clean.substring(start);
    const end = clean.lastIndexOf('</Submarine>');
    return end !== -1 ? clean.substring(0, end + 12) : clean;
}

// --- Submarine Processing ---
function processSubmarine() {
    globalItemMap = {};
    currentXmlDoc.querySelectorAll('Item').forEach(item => {
        globalItemMap[item.getAttribute('ID')] = item.getAttribute('identifier');
    });

    const boxes = currentXmlDoc.querySelectorAll('Item[identifier="circuitbox"]');
    circuitList.innerHTML = '';
    svgContainer.innerHTML = '';

    if (boxes.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No Circuit Boxes Found';
        li.className = 'placeholder';
        circuitList.appendChild(li);
        return;
    }

    boxes.forEach((box, i) => {
        const boxId = box.getAttribute('ID');
        const li = document.createElement('li');
        li.textContent = `Box #${boxId}`;
        li.onclick = () => {
            document.querySelectorAll('#circuitList li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            activeBoxId = boxId;
            renderCircuit(box);
        };
        circuitList.appendChild(li);
        if (i === 0) li.click();
    });
}

// --- Rendering ---
function renderCircuit(boxElement) {
    svgContainer.innerHTML = '';
    currentTransform = { x: 0, y: 0, zoom: 1 };
    const svg = createSVG(boxElement);
    if (svg) {
        svgContainer.appendChild(svg);
        setupZoomPan(svgContainer, svg);
    }
}

function createSVG(boxElement) {
    const circuitData = boxElement.querySelector('CircuitBox');
    if (!circuitData) return null;

    const container = boxElement.querySelector('ItemContainer');
    const containedIds = container?.getAttribute('contained')?.split(/[;,]/).filter(x => x) || [];

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '-1500 -1200 3000 2400');
    const nodeCoords = {};
    const allPoints = []; // collects {x,y} of every drawn element for tight export viewBox

    const drawRail = (sel, isLeft) => {
        const node = circuitData.querySelector(sel);
        if (!node) return;
        const posStr = node.getAttribute('pos');
        if (!posStr) return;
        const [bx, by] = posStr.split(',').map(Number);
        const labels = {};
        node.querySelectorAll('ConnectionLabelOverride').forEach(l => {
            labels[l.getAttribute('name')] = l.getAttribute('value');
        });

        for (let i = 0; i < 10; i++) {
            const name = `signal_${isLeft ? 'in' : 'out'}${i}`;
            const x = bx, y = -(by - (i * 120));
            nodeCoords[name] = { x, y };
            allPoints.push({ x, y });

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '10');
            c.setAttribute('fill', isLeft ? '#10b981' : '#ef4444');

            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', x + (isLeft ? -20 : 20)); t.setAttribute('y', y + 6);
            t.setAttribute('fill', '#94a3b8'); t.setAttribute('text-anchor', isLeft ? 'end' : 'start');
            t.setAttribute('font-size', '18');
            t.textContent = labels[name] || name.toUpperCase();
            g.appendChild(c); g.appendChild(t); svg.appendChild(g);
        }
    };

    drawRail('InputNode', true);
    drawRail('OutputNode', false);

    circuitData.querySelectorAll('Component').forEach((comp) => {
        const posStr = comp.getAttribute('position');
        if (!posStr) return;
        const [x, y] = posStr.split(',').map(Number);
        const id = comp.getAttribute('id');
        const invY = -y;

        // component id IS the index into containedIds, not the XML enumerate position
        const globalId = containedIds[parseInt(id)];
        const actualItem = currentXmlDoc.querySelector(`Item[ID="${globalId}"]`);
        const ident = actualItem ? actualItem.getAttribute('identifier') : (globalItemMap[globalId] || 'unknown');
        const def = COMPONENT_DEFS[ident] || { name: ident.toUpperCase(), leftPins: ['signal_in1'], rightPins: ['signal_out'], properties: [] };

        const propsToRender = [];
        def.properties.forEach(p => {
            let val = null;
            if (actualItem) {
                for (let j = 0; j < actualItem.children.length; j++) {
                    val = getAttrCI(actualItem.children[j], p);
                    if (val !== null) break;
                }
                if (val === null) val = getAttrCI(actualItem, p);
            }
            if (val !== null) propsToRender.push({ name: p, val });
        });

        const h = Math.max(def.leftPins.length, def.rightPins.length) * 35 + 60 + (propsToRender.length * 15);
        const w = 220;
        allPoints.push({ x: x - w/2, y: invY - h/2 }, { x: x + w/2, y: invY + h/2 });
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        const mkRect = (rx, ry, rw, rh, fill, str = 'none') => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', rx); el.setAttribute('y', ry);
            el.setAttribute('width', rw); el.setAttribute('height', rh);
            el.setAttribute('fill', fill); el.setAttribute('stroke', str);
            el.setAttribute('rx', 4);
            return el;
        };

        g.appendChild(mkRect(x - w/2, invY - h/2, w, h, '#1e293b', '#334155'));
        g.appendChild(mkRect(x - w/2, invY - h/2, w, 30, '#334155'));

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        title.setAttribute('x', x); title.setAttribute('y', invY - h/2 + 20);
        title.setAttribute('fill', '#38bdf8'); title.setAttribute('text-anchor', 'middle');
        title.setAttribute('font-size', '14'); title.setAttribute('font-weight', 'bold');
        title.textContent = def.name;
        g.appendChild(title);

        const processPins = (pins, left) => {
            pins.forEach((p, i) => {
                const px = left ? x - w/2 : x + w/2;
                const py = (invY - h/2 + 55) + (i * 30);
                nodeCoords[`${id}_${p}`] = { x: px, y: py };

                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                dot.setAttribute('cx', px); dot.setAttribute('cy', py);
                dot.setAttribute('r', '5'); dot.setAttribute('fill', '#38bdf8');

                const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                lbl.setAttribute('x', px + (left ? 12 : -12)); lbl.setAttribute('y', py + 4);
                lbl.setAttribute('fill', '#64748b'); lbl.setAttribute('font-size', '11');
                lbl.setAttribute('text-anchor', left ? 'start' : 'end');
                lbl.textContent = p.toUpperCase();

                g.appendChild(dot); g.appendChild(lbl);
            });
        };
        processPins(def.leftPins, true);
        processPins(def.rightPins, false);

        propsToRender.forEach((propObj, i) => {
            const pt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            pt.setAttribute('x', x - w/2 + 10);
            pt.setAttribute('y', invY + h/2 - 15 - ((propsToRender.length - 1 - i) * 15));
            pt.setAttribute('fill', '#fbbf24');
            pt.setAttribute('font-size', '11');
            pt.setAttribute('font-family', 'monospace');
            pt.textContent = `${propObj.name.toUpperCase()}: ${propObj.val}`;
            g.appendChild(pt);
        });

        svg.appendChild(g);
    });

    circuitData.querySelectorAll('Wire').forEach(w => {
        const f = w.querySelector('From'), t = w.querySelector('To');
        if (!f || !t) return;

        const p1 = f.getAttribute('target') === '' ? nodeCoords[f.getAttribute('name')] : nodeCoords[`${f.getAttribute('target')}_${f.getAttribute('name')}`];
        const p2 = t.getAttribute('target') === '' ? nodeCoords[t.getAttribute('name')] : nodeCoords[`${t.getAttribute('target')}_${t.getAttribute('name')}`];

        if (p1 && p2) {
            const prefabKey = (w.getAttribute('prefab') || 'orangewire').toLowerCase();
            const wireColor = WIRE_COLORS[prefabKey] || WIRE_COLORS['orangewire'];

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const dx = Math.min(Math.abs(p1.x - p2.x) / 1.5, 400);
            path.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`);
            path.setAttribute('stroke', wireColor);
            path.setAttribute('stroke-width', '2.5');
            path.setAttribute('fill', 'none');
            path.setAttribute('opacity', '0.75');
            svg.insertBefore(path, svg.firstChild);
        }
    });

    // Compute tight bounding box from all drawn points and store for export
    if (allPoints.length > 0) {
        const PAD = 60;
        const minX = Math.min(...allPoints.map(p => p.x)) - PAD;
        const minY = Math.min(...allPoints.map(p => p.y)) - PAD;
        const maxX = Math.max(...allPoints.map(p => p.x)) + PAD;
        const maxY = Math.max(...allPoints.map(p => p.y)) + PAD;
        svg.dataset.exportViewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
    }
    return svg;
}

// --- SVG Export ---
function downloadSVG() {
    const svgEl = svgContainer.querySelector('svg');
    if (!svgEl) return;
    const exportSvg = svgEl.cloneNode(true);
    // Use the tight content viewBox computed at build time, not the current pan/zoom viewBox
    if (svgEl.dataset.exportViewBox) {
        exportSvg.setAttribute('viewBox', svgEl.dataset.exportViewBox);
    }
    // Remove inline width/height so the viewBox governs sizing in external viewers
    exportSvg.removeAttribute('width');
    exportSvg.removeAttribute('height');
    exportSvg.style.backgroundColor = '#000';
    const source = new XMLSerializer().serializeToString(exportSvg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CircuitBox_${activeBoxId || 'export'}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// --- Utils ---
function getAttrCI(node, attrName) {
    if (!node || !node.attributes) return null;
    const lower = attrName.toLowerCase();
    for (let i = 0; i < node.attributes.length; i++) {
        if (node.attributes[i].name.toLowerCase() === lower) {
            let v = node.attributes[i].value;
            if (v.length > 30) v = v.substring(0, 30) + '...';
            return v;
        }
    }
    return null;
}

function setupZoomPan(container, svg) {
    const update = () => {
        const w = 3000 / currentTransform.zoom, h = 2400 / currentTransform.zoom;
        const x = -1500 + currentTransform.x, y = -1200 + currentTransform.y;
        svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    };
    container.onwheel = (e) => {
        e.preventDefault();
        currentTransform.zoom = Math.min(Math.max(currentTransform.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.1), 10);
        update();
    };
    container.onmousedown = (e) => { isDragging = true; lastMousePos = { x: e.clientX, y: e.clientY }; };
    window.onmousemove = (e) => {
        if (!isDragging) return;
        currentTransform.x += (lastMousePos.x - e.clientX) * (1 / currentTransform.zoom);
        currentTransform.y += (lastMousePos.y - e.clientY) * (1 / currentTransform.zoom);
        lastMousePos = { x: e.clientX, y: e.clientY };
        update();
    };
    window.onmouseup = () => isDragging = false;
    document.getElementById('resetView').onclick = () => { currentTransform = { x: 0, y: 0, zoom: 1 }; update(); };
    document.getElementById('downloadSVG').onclick = downloadSVG;
}

function updateStatus(m, err = false) {
    status.style.color = err ? '#ef4444' : '#38bdf8';
    status.textContent = m;
}
