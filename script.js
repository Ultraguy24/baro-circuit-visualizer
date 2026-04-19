let globalXmlDoc = null;
let globalItemMap = {};
let currentTransform = { x: 0, y: 0, zoom: 1 };
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };
let activeBoxId = null;

// Wire color palette optimized for dark mode
const WIRE_COLORS = {
    "wire": "#cbd5e1",        // Light grey (Uncoloured)
    "blackwire": "#475569",   // Dark grey (Black wire, lightened for visibility)
    "bluewire": "#3b82f6",    // Blue
    "brownwire": "#b45309",   // Brown
    "greenwire": "#10b981",   // Green
    "orangewire": "#f97316",  // Orange
    "redwire": "#ef4444"      // Red
};

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const circuitList = document.getElementById('circuitList');
const svgContainer = document.getElementById('svgContainer');
const status = document.getElementById('status');

// --- File Handling ---
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('active');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('active'));

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

async function handleFile(file) {
    if (!file) return;
    updateStatus(`Loading ${file.name}...`);
    try {
        const arrayBuffer = await file.arrayBuffer();
        let buffer = new Uint8Array(arrayBuffer);

        try { buffer = pako.ungzip(buffer); } catch(e) {}

        const offset = findGzipSignature(buffer);
        if (offset === -1) throw new Error("No submarine data found.");

        const sliced = buffer.slice(offset);
        let xmlText;
        try { xmlText = pako.ungzip(sliced, { to: 'string' }); }
        catch(e) { xmlText = pako.inflateRaw(sliced.slice(10), { to: 'string' }); }

        const parser = new DOMParser();
        globalXmlDoc = parser.parseFromString(sanitizeXml(xmlText), "text/xml");
        processSubmarine();
        updateStatus("Logic Extracted.");
    } catch (err) {
        updateStatus(err.message, true);
    }
}

function processSubmarine() {
    globalItemMap = {};
    globalXmlDoc.querySelectorAll('Item').forEach(item => {
        globalItemMap[item.getAttribute('ID')] = item.getAttribute('identifier');
    });

    const boxes = globalXmlDoc.querySelectorAll('Item[identifier="circuitbox"]');
    circuitList.innerHTML = "";
    boxes.forEach((box, i) => {
        const boxId = box.getAttribute('ID');
        const li = document.createElement('li');
        li.textContent = `Box #${boxId}`;
        li.onclick = () => {
            document.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            activeBoxId = boxId;
            renderCircuit(box);
        };
        circuitList.appendChild(li);
        if (i === 0) li.click();
    });
}

// --- Rendering Engine ---
function renderCircuit(boxElement) {
    svgContainer.innerHTML = "";
    currentTransform = { x: 0, y: 0, zoom: 1 };
    const svg = createSVG(boxElement);
    svgContainer.appendChild(svg);
    setupZoomPan(svgContainer, svg);
}

function createSVG(boxElement) {
    const circuitData = boxElement.querySelector('CircuitBox');
    const container = boxElement.querySelector('ItemContainer');

    const containedIds = container?.getAttribute('contained').split(/[;,]/).filter(x => x) || [];

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("viewBox", "-1500 -1200 3000 2400");
    const nodeCoords = {};

    // 1. External Rails
    const drawRail = (sel, isLeft) => {
        const node = circuitData.querySelector(sel);
        if (!node) return;
        const [bx, by] = node.getAttribute('pos').split(',').map(Number);
        const labels = {};
        node.querySelectorAll('ConnectionLabelOverride').forEach(l => labels[l.getAttribute('name')] = l.getAttribute('value'));

        for (let i = 0; i < 10; i++) {
            const name = `signal_${isLeft ? 'in' : 'out'}${i}`;
            const x = bx, y = -(by - (i * 120));
            nodeCoords[name] = { x, y };

            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", "10");
            c.setAttribute("fill", isLeft ? "#10b981" : "#ef4444");

            const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
            t.setAttribute("x", x + (isLeft ? -20 : 20)); t.setAttribute("y", y + 6);
            t.setAttribute("fill", "#94a3b8"); t.setAttribute("text-anchor", isLeft ? "end" : "start");
            t.setAttribute("font-size", "18"); t.textContent = labels[name] || name.toUpperCase();

            g.appendChild(c); g.appendChild(t); svg.appendChild(g);
        }
    };
    drawRail('InputNode', true); drawRail('OutputNode', false);

    // 2. Components
    circuitData.querySelectorAll('Component').forEach((comp, idx) => {
        const [x, y] = comp.getAttribute('position').split(',').map(Number);
        const id = comp.getAttribute('id');
        const invY = -y;

        const globalId = containedIds[idx];
        const actualItem = globalXmlDoc.querySelector(`Item[ID="${globalId}"]`);
        const ident = actualItem ? actualItem.getAttribute('identifier') : (globalItemMap[globalId] || "unknown");

        const def = COMPONENT_DEFS[ident] || { name: ident.toUpperCase(), leftPins: ["signal_in1"], rightPins: ["signal_out"], properties: [] };

        const propsToRender = [];
        def.properties.forEach(p => {
            let val = null;
            if (actualItem) {
                for (let j = 0; j < actualItem.children.length; j++) {
                    val = getAttrCaseInsensitive(actualItem.children[j], p);
                    if (val !== null) break;
                }
                if (val === null) val = getAttrCaseInsensitive(actualItem, p);
            }
            if (val !== null) {
                propsToRender.push({ name: p, val: val });
            }
        });

        const h = Math.max(def.leftPins.length, def.rightPins.length) * 35 + 60 + (propsToRender.length * 15);
        const w = 220;

        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

        const rect = (rx, ry, rw, rh, fill, str = "none") => {
            const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            el.setAttribute("x", rx); el.setAttribute("y", ry); el.setAttribute("width", rw); el.setAttribute("height", rh);
            el.setAttribute("fill", fill); el.setAttribute("stroke", str); el.setAttribute("rx", 4);
            return el;
        };
        g.appendChild(rect(x - w/2, invY - h/2, w, h, "#1e293b", "#334155"));
        g.appendChild(rect(x - w/2, invY - h/2, w, 30, "#334155"));

        const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
        title.setAttribute("x", x); title.setAttribute("y", invY - h/2 + 20);
        title.setAttribute("fill", "#38bdf8"); title.setAttribute("text-anchor", "middle");
        title.setAttribute("font-size", "14"); title.setAttribute("font-weight", "bold");
        title.textContent = def.name;
        g.appendChild(title);

        const processPins = (pins, left) => {
            pins.forEach((p, i) => {
                const px = left ? x - w/2 : x + w/2;
                const py = (invY - h/2 + 55) + (i * 30);
                nodeCoords[`${id}_${p}`] = { x: px, y: py };

                const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("r", "5");
                dot.setAttribute("fill", "#38bdf8");

                const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
                lbl.setAttribute("x", px + (left ? 12 : -12)); lbl.setAttribute("y", py + 4);
                lbl.setAttribute("fill", "#64748b"); lbl.setAttribute("font-size", "11");
                lbl.setAttribute("text-anchor", left ? "start" : "end"); lbl.textContent = p.toUpperCase();

                g.appendChild(dot); g.appendChild(lbl);
            });
        };
        processPins(def.leftPins, true); processPins(def.rightPins, false);

        propsToRender.forEach((propObj, i) => {
            const pt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            pt.setAttribute("x", x - w/2 + 10);
            pt.setAttribute("y", invY + h/2 - 15 - ((propsToRender.length - 1 - i) * 15));
            pt.setAttribute("fill", "#fbbf24");
            pt.setAttribute("font-size", "11");
            pt.setAttribute("font-family", "monospace");
            pt.textContent = `${propObj.name.toUpperCase()}: ${propObj.val}`;
            g.appendChild(pt);
        });

        svg.appendChild(g);
    });

    // 3. Wires
    circuitData.querySelectorAll('Wire').forEach(w => {
        const f = w.querySelector('From'), t = w.querySelector('To');
        const p1 = f.getAttribute('target') === "" ? nodeCoords[f.getAttribute('name')] : nodeCoords[`${f.getAttribute('target')}_${f.getAttribute('name')}`];
        const p2 = t.getAttribute('target') === "" ? nodeCoords[t.getAttribute('name')] : nodeCoords[`${t.getAttribute('target')}_${t.getAttribute('name')}`];

        if (p1 && p2) {
            const prefabAttr = w.getAttribute('prefab');
            const prefabKey = prefabAttr ? prefabAttr.toLowerCase() : "orangewire";
            const wireColor = WIRE_COLORS[prefabKey] || WIRE_COLORS["orangewire"];

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const dx = Math.min(Math.abs(p1.x - p2.x) / 1.5, 400);
            path.setAttribute("d", `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`);
            path.setAttribute("stroke", wireColor);
            path.setAttribute("stroke-width", "2.5");
            path.setAttribute("fill", "none");
            path.setAttribute("opacity", "0.75");
            svg.insertBefore(path, svg.firstChild);
        }
    });

    return svg;
}

// --- SVG Export ---
function downloadSVG() {
    const svgEl = svgContainer.querySelector('svg');
    if (!svgEl) return;

    // Use a clone to avoid messing with the live view during export
    const exportSvg = svgEl.cloneNode(true);
    exportSvg.style.backgroundColor = "#000"; // Ensure dark background is part of the export

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(exportSvg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `CircuitBox_${activeBoxId || 'export'}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// --- Utils & Viewport ---

function getAttrCaseInsensitive(node, attrName) {
    if (!node || !node.attributes) return null;
    const lowerName = attrName.toLowerCase();
    for (let i = 0; i < node.attributes.length; i++) {
        if (node.attributes[i].name.toLowerCase() === lowerName) {
            let v = node.attributes[i].value;
            if (v.length > 30) v = v.substring(0, 30) + "...";
            return v;
        }
    }
    return null;
}

function setupZoomPan(container, svg) {
    const update = () => {
        const w = 3000 / currentTransform.zoom, h = 2400 / currentTransform.zoom;
        const x = -1500 + currentTransform.x, y = -1200 + currentTransform.y;
        svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    };
    container.onwheel = (e) => { e.preventDefault(); currentTransform.zoom = Math.min(Math.max(currentTransform.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.1), 10); update(); };
    container.onmousedown = (e) => { isDragging = true; lastMousePos = { x: e.clientX, y: e.clientY }; };
    window.onmousemove = (e) => {
        if (!isDragging) return;
        currentTransform.x += (lastMousePos.x - e.clientX) * (1/currentTransform.zoom);
        currentTransform.y += (lastMousePos.y - e.clientY) * (1/currentTransform.zoom);
        lastMousePos = { x: e.clientX, y: e.clientY };
        update();
    };
    window.onmouseup = () => isDragging = false;
    document.getElementById('resetView').onclick = () => { currentTransform = { x: 0, y: 0, zoom: 1 }; update(); };
    document.getElementById('downloadSVG').onclick = downloadSVG;
}

function findGzipSignature(b) { for (let i = 0; i < b.length - 3; i++) if (b[i] === 0x1F && b[i+1] === 0x8B && b[i+2] === 0x08) return i; return -1; }
function sanitizeXml(s) { const end = s.lastIndexOf("</Submarine>"); return end !== -1 ? s.substring(0, end + 12) : s; }
function updateStatus(m, err = false) { status.style.color = err ? "#ef4444" : "#38bdf8"; status.textContent = m; }