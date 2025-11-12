const INITIAL_VIEW = {
  center: [41.725, 1.821],
  zoom: 8
};

const map = L.map('map', {
  zoomSnap: 0.5,
  minZoom: 5,
  maxZoom: 19
}).setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19,
  detectRetina: true
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

map.whenReady(() => {
  map.invalidateSize();
});

const fileInput = document.getElementById('file');
const clearButton = document.getElementById('clear-btn');
const progress = document.getElementById('progress');
const progressLabel = progress.querySelector('.progress__label');
const progressPercent = progress.querySelector('span');
const progressBarFill = progress.querySelector('.progress__bar-fill');
const progressMessageNode = progressLabel.childNodes[0];
const summaryCards = document.getElementById('summary-cards');
const summaryCount = document.getElementById('summary-count');
const comparableList = document.getElementById('comparable-list');

const comparables = [];

fileInput.addEventListener('change', handleFileSelect);
clearButton.addEventListener('click', resetView);

function handleFileSelect(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  resetData();
  showProgress('Leyendo archivo…', 2);

  const reader = new FileReader();
  reader.onprogress = (ev) => {
    if (!ev.lengthComputable) return;
    const percent = Math.round((ev.loaded / ev.total) * 60);
    showProgress('Leyendo archivo…', Math.min(percent, 60));
  };

  reader.onload = (ev) => {
    showProgress('Procesando datos…', 75);
    try {
      const workbook = XLSX.read(ev.target.result, { type: 'array' });
      const data = extractComparables(workbook);
      if (!data.length) {
        throw new Error('No se encontraron registros con coordenadas válidas.');
      }
      renderComparables(data);
      showProgress('Listo', 100);
      setTimeout(() => hideProgress(), 600);
    } catch (error) {
      console.error(error);
      alert(
        'No se pudo leer el archivo. Comprueba que existe la hoja "EEMM" y que la columna COORD contiene latitud y longitud.'
      );
      hideProgress();
    }
  };

  reader.onerror = () => {
    alert('Ocurrió un error al leer el archivo.');
    hideProgress();
  };

  reader.readAsArrayBuffer(file);
}

function extractComparables(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name.trim().toUpperCase() === 'EEMM') ??
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }

  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return raw
    .map((row, index) => normaliseRow(row, index))
    .filter((row) => row !== null);
}

function normaliseRow(row, index) {
  const coordinates = parseCoordinates(row.COORD ?? row.Coord ?? row.coord);
  if (!coordinates) {
    return null;
  }

  const promotion = row.Promoción || row.Promocion || '';
  const ref = row.Ref || row.REF || `Comparable ${index + 1}`;
  const typology = row.Tipología || row.Tipologia || '';
  const link = row.Link || row.URL || '';

  return {
    index,
    coordinates,
    ref,
    promotion,
    address: row.dirección || row.Dirección || row.Direccion || '',
    units: row.unidades || row.Unidades || '',
    price: row.pvp || row.PVP || '',
    vrm: row['VRM SCIC'] || row.VRMSCIC || row.VRMSCic || '',
    dorms: row['nº dorm'] || row['nº dormitorios'] || row.dorm || '',
    link,
    typology,
    floor: row.planta || row.Planta || '',
    raw: row
  };
}

function parseCoordinates(value) {
  if (!value) return null;

  const text = String(value)
    .replace(/[;\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const matches = text.match(/[-+]?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) {
    return null;
  }

  const [latRaw, lngRaw] = matches;
  const lat = Number(latRaw.replace(',', '.'));
  const lng = Number(lngRaw.replace(',', '.'));

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }

  return [lat, lng];
}

function renderComparables(data) {
  comparables.length = 0;
  markersLayer.clearLayers();
  comparableList.innerHTML = '';
  summaryCards.innerHTML = '';

  const bounds = [];
  const template = document.getElementById('card-template');

  data.forEach((item, idx) => {
    const marker = createMarker(item, idx + 1);
    marker.addTo(markersLayer);
    bounds.push(item.coordinates);

    const comparable = { ...item, marker };
    comparables.push(comparable);

    const listItem = buildComparableListItem(comparable, idx);
    comparableList.appendChild(listItem);

    const card = buildSummaryCard(template, comparable, idx);
    summaryCards.appendChild(card);
  });

  updateSummaryCount(data.length);

  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40] });
  } else if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  }
}

function createMarker(item, order) {
  const icon = L.divIcon({
    className: 'custom-marker',
    html: `<div class="marker-label">${order}</div>`,
    iconSize: [36, 46],
    iconAnchor: [18, 46]
  });

  const marker = L.marker(item.coordinates, { icon });
  marker.bindPopup(buildPopupContent(item));
  return marker;
}

function buildPopupContent(item) {
  const lines = [
    `<strong>${escapeHtml(item.ref)}</strong>`,
    item.address ? escapeHtml(item.address) : null,
    item.promotion ? `<em>${escapeHtml(item.promotion)}</em>` : null,
    buildPopupDetail('Tipología', item.typology),
    buildPopupDetail('Unidades', item.units),
    buildPopupDetail('PVP', item.price),
    buildPopupDetail('VRM SCIC', item.vrm),
    buildPopupDetail('Dormitorios', item.dorms),
    buildPopupDetail('Planta', item.floor),
    item.link
      ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Abrir ficha</a>`
      : null
  ].filter(Boolean);

  return `<div class="popup">${lines.join('<br>')}</div>`;
}

function buildPopupDetail(label, value) {
  if (value === undefined || value === null || value === '') return null;
  return `<span class="popup__detail"><strong>${label}:</strong> ${escapeHtml(value)}</span>`;
}

function buildComparableListItem(item, idx) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'comparable-item';
  element.innerHTML = `
    <span class="comparable-item__title">${idx + 1}. ${escapeHtml(item.ref)}</span>
    <span class="comparable-item__meta">${escapeHtml(item.promotion || 'Sin promoción')}</span>
  `;

  element.addEventListener('click', () => {
    focusComparable(item, element);
  });

  item.marker.on('click', () => {
    setActiveComparable(element);
  });

  return element;
}

function buildSummaryCard(template, item, idx) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.querySelector('.summary-card__title').textContent = `${idx + 1}. ${item.ref}`;
  node.querySelector('.summary-card__subtitle').textContent = item.promotion || 'Sin promoción';

  const dl = node.querySelector('.summary-card__details');
  addDefinition(dl, 'Dirección', item.address);
  addDefinition(dl, 'Tipología', item.typology);
  addDefinition(dl, 'Unidades', item.units);
  addDefinition(dl, 'PVP', item.price);
  addDefinition(dl, 'VRM SCIC', item.vrm);
  addDefinition(dl, 'Dormitorios', item.dorms);
  addDefinition(dl, 'Planta', item.floor);

  const link = node.querySelector('.summary-card__link');
  if (item.link) {
    link.href = item.link;
  } else {
    link.href = '#';
    link.textContent = 'Sin enlace disponible';
    link.classList.add('is-disabled');
    link.addEventListener('click', (event) => event.preventDefault());
  }

  node.addEventListener('mouseenter', () => {
    item.marker.openPopup();
  });

  node.addEventListener('mouseleave', () => {
    item.marker.closePopup();
  });

  return node;
}

function addDefinition(dl, term, value) {
  if (value === undefined || value === null || value === '') return;
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.append(dt, dd);
}

function focusComparable(item, element) {
  map.setView(item.coordinates, Math.max(map.getZoom(), 14));
  item.marker.openPopup();
  setActiveComparable(element);
}

function setActiveComparable(element) {
  document
    .querySelectorAll('.comparable-item.is-active')
    .forEach((node) => node.classList.remove('is-active'));
  element.classList.add('is-active');
}

function updateSummaryCount(count) {
  if (!count) {
    summaryCount.textContent = 'No hay comparables cargados.';
  } else {
    summaryCount.textContent = `${count} comparables cargados.`;
  }
}

function resetData() {
  comparables.length = 0;
  markersLayer.clearLayers();
  comparableList.innerHTML = '';
  summaryCards.innerHTML = '';
  updateSummaryCount(0);
}

function resetView() {
  fileInput.value = '';
  resetData();
  map.setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);
  hideProgress();
}

function showProgress(label, percent) {
  progress.hidden = false;
  if (progressMessageNode) {
    progressMessageNode.textContent = `${label} `;
  }
  progressPercent.textContent = `${Math.max(0, Math.min(percent, 100))}%`;
  progressBarFill.style.width = `${percent}%`;
}

function hideProgress() {
  progress.hidden = true;
  progressBarFill.style.width = '0%';
  if (progressMessageNode) {
    progressMessageNode.textContent = 'Leyendo archivo… ';
  }
  progressPercent.textContent = '0%';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('resize', () => {
  map.invalidateSize();
});
