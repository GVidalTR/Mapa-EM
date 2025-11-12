const map = L.map('map', {
  center: [42.5063, 1.5218],
  zoom: 13,
  zoomControl: false,
  minZoom: 3,
});

const baseLayers = {
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }),
};

baseLayers.light.addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const labelLayer = L.layerGroup().addTo(map);

const state = {
  comparables: [],
  filtered: [],
  filters: {
    tipologia: new Set(),
    planta: new Set(),
    dormitorios: new Set(),
  },
  selectedCodes: new Set(),
  theme: 'light',
  markersVisible: true,
  labelsVisible: true,
};

const DOM = {
  fileInput: document.getElementById('fileInput'),
  fileLabel: document.getElementById('fileLabel'),
  clearData: document.getElementById('clearData'),
  uploadStatus: document.getElementById('uploadStatus'),
  statComparables: document.getElementById('statComparables'),
  statFiltered: document.getElementById('statFiltered'),
  filtersContainer: document.getElementById('filtersContainer'),
  resetFilters: document.getElementById('resetFilters'),
  comparableList: document.getElementById('comparableList'),
  selectAll: document.getElementById('selectAll'),
  selectNone: document.getElementById('selectNone'),
  toggleMarkers: document.getElementById('toggleMarkers'),
  toggleLabels: document.getElementById('toggleLabels'),
  labelScale: document.getElementById('labelScale'),
  labelColor: document.getElementById('labelColor'),
  toggleTheme: document.getElementById('toggleTheme'),
  fitBounds: document.getElementById('fitBounds'),
};

const markerEntries = new Map();

function getLabelColor() {
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue('--label-color')
    .trim();
  return color || '#2563eb';
}

function normalizeRow(row) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    const cleanKey = String(key).trim();
    if (!cleanKey) return;
    if (typeof value === 'string') {
      normalized[cleanKey] = value.trim();
    } else {
      normalized[cleanKey] = value;
    }
  });
  return normalized;
}

function detectColumns(rows) {
  const columns = {
    code: null,
    coord: null,
    tipologia: null,
    planta: null,
    dormitorios: null,
    name: null,
    promotion: null,
  };

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const lower = key.toLowerCase();
      if (!columns.code && lower.includes('codigo') && (lower.includes('comparable') || lower.includes('promo'))) {
        columns.code = key;
      }
      if (!columns.code && (lower === 'codigo' || lower === 'ref')) {
        columns.code = key;
      }
      if (!columns.coord && lower.includes('coord')) {
        columns.coord = key;
      }
      if (!columns.tipologia && lower.includes('tipolog')) {
        columns.tipologia = key;
      }
      if (!columns.planta && lower.includes('planta')) {
        columns.planta = key;
      }
      if (!columns.dormitorios && (lower.includes('dorm') || lower.includes('habitac'))) {
        columns.dormitorios = key;
      }
      if (!columns.name && (lower.includes('nombre') || lower.includes('proyecto'))) {
        columns.name = key;
      }
      if (!columns.promotion && lower.includes('promoc')) {
        columns.promotion = key;
      }
    }
  }

  return columns;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, '');
  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;
  let working = normalized;

  if (commaCount && dotCount) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      working = normalized.replace(/\./g, '').replace(/,/g, '.');
    } else {
      working = normalized.replace(/,/g, '');
    }
  } else if (commaCount) {
    working = normalized.replace(/\.(?=\d{3}(?:[^0-9]|$))/g, '').replace(/,/g, '.');
  } else if (dotCount) {
    working = normalized.replace(/,(?=\d{3}(?:[^0-9]|$))/g, '');
  }

  const cleaned = working.replace(/[^0-9+\-.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinates(value) {
  if (!value) return null;
  const matches = String(value)
    .replace(/[\[\]()]/g, ' ')
    .match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) return null;
  const [latToken, lngToken] = matches;
  const lat = Number.parseFloat(latToken.replace(',', '.'));
  const lng = Number.parseFloat(lngToken.replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function mostCommonValue(counter) {
  let best = null;
  let bestCount = 0;
  counter.forEach((count, key) => {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  });
  return best;
}

function aggregateComparables(rows) {
  const normalizedRows = rows.map(normalizeRow);
  const columns = detectColumns(normalizedRows);
  const groups = new Map();

  for (const row of normalizedRows) {
    const codeKey = columns.code;
    const rawCode = codeKey ? row[codeKey] : Object.values(row)[0];
    if (!rawCode) continue;
    const code = String(rawCode).trim();
    if (!code) continue;

    if (!groups.has(code)) {
      groups.set(code, {
        code,
        rows: [],
        coords: null,
        tipologias: new Map(),
        plantas: new Map(),
        dormitorios: new Map(),
        nombres: new Map(),
        promociones: new Map(),
        numericSums: new Map(),
        numericCounts: new Map(),
        sampleCount: 0,
      });
    }

    const group = groups.get(code);
    group.sampleCount += 1;
    group.rows.push(row);

    if (columns.coord) {
      const coords = parseCoordinates(row[columns.coord]);
      if (coords) {
        group.coords = coords;
      }
    }

    if (columns.tipologia) {
      const value = row[columns.tipologia];
      if (value) {
        const label = String(value).trim();
        group.tipologias.set(label, (group.tipologias.get(label) || 0) + 1);
      }
    }

    if (columns.planta) {
      const value = row[columns.planta];
      if (value !== undefined && value !== null && value !== '') {
        const label = String(value).trim();
        group.plantas.set(label, (group.plantas.get(label) || 0) + 1);
      }
    }

    if (columns.dormitorios) {
      const value = row[columns.dormitorios];
      if (value !== undefined && value !== null && value !== '') {
        const label = String(value).trim();
        group.dormitorios.set(label, (group.dormitorios.get(label) || 0) + 1);
      }
    }

    if (columns.name) {
      const value = row[columns.name];
      if (value) {
        const label = String(value).trim();
        group.nombres.set(label, (group.nombres.get(label) || 0) + 1);
      }
    }

    if (columns.promotion) {
      const value = row[columns.promotion];
      if (value) {
        const label = String(value).trim();
        group.promociones.set(label, (group.promociones.get(label) || 0) + 1);
      }
    }

    for (const [key, value] of Object.entries(row)) {
      const numeric = toNumber(value);
      if (numeric === null) continue;
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('coord')) continue;
      if (!group.numericSums.has(key)) {
        group.numericSums.set(key, 0);
        group.numericCounts.set(key, 0);
      }
      group.numericSums.set(key, group.numericSums.get(key) + numeric);
      group.numericCounts.set(key, group.numericCounts.get(key) + 1);
    }
  }

  const comparables = [];

  groups.forEach((group) => {
    const averages = {};
    group.numericSums.forEach((sum, key) => {
      const count = group.numericCounts.get(key) || 1;
      averages[key] = sum / count;
    });

    const tipologia = mostCommonValue(group.tipologias) || '';
    const planta = mostCommonValue(group.plantas) || '';
    const dormitorios = mostCommonValue(group.dormitorios) || '';
    const nombre = mostCommonValue(group.nombres) || '';
    const promocion = mostCommonValue(group.promociones) || '';

    const metrics = extractMetrics(averages);

    comparables.push({
      code: group.code,
      coords: group.coords,
      tipologia,
      planta,
      dormitorios,
      nombre: nombre || group.code,
      promocion,
      averages,
      metrics,
      samples: group.sampleCount,
    });
  });

  return comparables;
}

function extractMetrics(averages) {
  const entries = Object.entries(averages);

  const getByPatterns = (patterns, exclude = []) => {
    for (const [key, value] of entries) {
      const lower = key.toLowerCase();
      if (exclude.some((pattern) => lower.includes(pattern))) {
        continue;
      }
      if (patterns.some((pattern) => lower.includes(pattern))) {
        return value;
      }
    }
    return null;
  };

  const unitPrice = getByPatterns(['unitario', '€/m', 'precio m', 'precio/m', 'ppu', 'pu '], ['superficie']);
  const totalPrice = getByPatterns(['precio total', 'precio_total', 'total', 'importe'], ['unitario']);
  const surface = getByPatterns(['superficie', 'sup', 'm2', 'm²'], ['precio']);

  return {
    unitPrice,
    totalPrice,
    surface,
  };
}

function formatCurrency(value) {
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatNumber(value) {
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
}

function buildPopupContent(comparable) {
  const rows = [];
  rows.push(`<strong>${comparable.nombre}</strong>`);
  if (comparable.promocion && comparable.promocion !== comparable.nombre) {
    rows.push(`<div>${comparable.promocion}</div>`);
  }
  rows.push(`<div><small>Código:</small> ${comparable.code}</div>`);
  if (comparable.tipologia) {
    rows.push(`<div><small>Tipología:</small> ${comparable.tipologia}</div>`);
  }
  if (comparable.planta) {
    rows.push(`<div><small>Planta:</small> ${comparable.planta}</div>`);
  }
  if (comparable.dormitorios) {
    rows.push(`<div><small>Dormitorios:</small> ${comparable.dormitorios}</div>`);
  }
  rows.push(`<div><small>Muestras:</small> ${comparable.samples}</div>`);

  if (comparable.metrics.surface) {
    rows.push(`<div><small>Sup. media:</small> ${formatNumber(comparable.metrics.surface)} m²</div>`);
  }
  if (comparable.metrics.totalPrice) {
    rows.push(`<div><small>Precio total medio:</small> ${formatCurrency(comparable.metrics.totalPrice)}</div>`);
  }
  if (comparable.metrics.unitPrice) {
    rows.push(`<div><small>Precio unitario medio:</small> ${formatCurrency(comparable.metrics.unitPrice)}</div>`);
  }

  return `<div class="popup">${rows.join('')}</div>`;
}

function buildLabelHTML(comparable) {
  const labelTheme = state.theme === 'dark' ? 'dark' : 'light';
  const value = comparable.metrics.unitPrice ?? comparable.metrics.totalPrice ?? null;
  const labelText = value ? formatCurrency(value) : comparable.code;
  return `<div class="data-label" data-theme="${labelTheme}">${labelText}</div>`;
}

function syncMarkers() {
  const visibleComparables = state.filtered.filter((item) =>
    state.selectedCodes.has(item.code) && Array.isArray(item.coords)
  );
  const visibleCodes = new Set(visibleComparables.map((item) => item.code));

  for (const [code, entry] of markerEntries.entries()) {
    if (!visibleCodes.has(code)) {
      if (entry.marker) {
        markerLayer.removeLayer(entry.marker);
      }
      if (entry.label) {
        labelLayer.removeLayer(entry.label);
      }
      markerEntries.delete(code);
    }
  }

  visibleComparables.forEach((comparable) => {
    let entry = markerEntries.get(comparable.code);
    const popupContent = buildPopupContent(comparable);
    const labelHTML = buildLabelHTML(comparable);

    if (!entry) {
      const baseColor = getLabelColor();
      const marker = L.circleMarker(comparable.coords, {
        radius: 9,
        color: baseColor,
        fillColor: baseColor,
        fillOpacity: 0.75,
        weight: 2,
      });
      marker.bindPopup(popupContent);
      markerLayer.addLayer(marker);

      const label = L.marker(comparable.coords, {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: labelHTML,
          iconAnchor: [0, 0],
        }),
      });
      labelLayer.addLayer(label);

      entry = { marker, label };
      markerEntries.set(comparable.code, entry);
    } else {
      const baseColor = getLabelColor();
      entry.marker.setLatLng(comparable.coords);
      entry.marker.setPopupContent(popupContent);
      entry.marker.setStyle({ fillColor: baseColor, color: baseColor });
      entry.label.setLatLng(comparable.coords);
      entry.label.setIcon(
        L.divIcon({
          className: '',
          html: labelHTML,
          iconAnchor: [0, 0],
        })
      );
    }
  });

  updateLayerVisibility();
}

function updateLayerVisibility() {
  if (state.markersVisible) {
    if (!map.hasLayer(markerLayer)) {
      markerLayer.addTo(map);
    }
  } else {
    if (map.hasLayer(markerLayer)) {
      map.removeLayer(markerLayer);
    }
  }

  if (state.labelsVisible) {
    if (!map.hasLayer(labelLayer)) {
      labelLayer.addTo(map);
    }
  } else {
    if (map.hasLayer(labelLayer)) {
      map.removeLayer(labelLayer);
    }
  }
}

function fitToVisibleMarkers() {
  const coords = [];
  markerEntries.forEach((entry) => {
    if (entry.marker && map.hasLayer(entry.marker)) {
      coords.push(entry.marker.getLatLng());
    }
  });
  if (!coords.length) return;
  const bounds = L.latLngBounds(coords);
  map.fitBounds(bounds.pad(0.2));
}

function renderFilters() {
  const definitions = [
    { key: 'tipologia', label: 'Tipología' },
    { key: 'planta', label: 'Planta' },
    { key: 'dormitorios', label: 'Dormitorios' },
  ];

  DOM.filtersContainer.innerHTML = '';

  definitions.forEach((definition) => {
    const options = Array.from(
      new Set(
        state.comparables
          .map((item) => item[definition.key])
          .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
      )
    ).sort((a, b) => String(a).localeCompare(String(b), 'es'));

    const activeSet = state.filters[definition.key];
    for (const value of Array.from(activeSet)) {
      if (!options.includes(value)) {
        activeSet.delete(value);
      }
    }

    if (!options.length) return;

    const group = document.createElement('div');
    group.className = 'filter-group';

    const title = document.createElement('h3');
    title.textContent = definition.label;
    group.appendChild(title);

    const wrapper = document.createElement('div');
    wrapper.className = 'filter-options';

    options.forEach((value) => {
      const id = `${definition.key}-${value}`.replace(/\s+/g, '-');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = value;
      checkbox.checked = activeSet.has(value);
      checkbox.id = id;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          activeSet.add(value);
        } else {
          activeSet.delete(value);
        }
        applyFilters();
      });

      const text = document.createElement('span');
      text.textContent = value;

      label.appendChild(checkbox);
      label.appendChild(text);
      wrapper.appendChild(label);
    });

    group.appendChild(wrapper);
    DOM.filtersContainer.appendChild(group);
  });

  const filtersActive = Object.values(state.filters).some((set) => set.size > 0);
  DOM.resetFilters.disabled = !filtersActive;
}

function renderComparableList() {
  DOM.comparableList.innerHTML = '';

  if (!state.filtered.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay comparables para los filtros seleccionados.';
    empty.className = 'empty';
    DOM.comparableList.appendChild(empty);
    DOM.selectAll.disabled = true;
    DOM.selectNone.disabled = true;
    return;
  }

  state.filtered
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, 'es'))
    .forEach((comparable) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'comparable-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selectedCodes.has(comparable.code);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedCodes.add(comparable.code);
        } else {
          state.selectedCodes.delete(comparable.code);
        }
        syncMarkers();
      });

      const info = document.createElement('div');
      info.className = 'comparable-item__info';

      const title = document.createElement('strong');
      title.textContent = `${comparable.code} · ${comparable.nombre}`;
      info.appendChild(title);

      const details = [];
      if (comparable.tipologia) details.push(comparable.tipologia);
      if (comparable.planta) details.push(`Planta ${comparable.planta}`);
      if (comparable.dormitorios) details.push(`${comparable.dormitorios} dorm.`);
      details.push(`${comparable.samples} muestras`);
      if (comparable.metrics.unitPrice) {
        details.push(`PU ${formatCurrency(comparable.metrics.unitPrice)}`);
      }

      const subtitle = document.createElement('span');
      subtitle.textContent = details.join(' · ');
      info.appendChild(subtitle);

      wrapper.appendChild(checkbox);
      wrapper.appendChild(info);
      DOM.comparableList.appendChild(wrapper);
    });

  DOM.selectAll.disabled = false;
  DOM.selectNone.disabled = false;
}

function applyFilters() {
  const filters = state.filters;
  state.filtered = state.comparables.filter((item) => {
    return Object.entries(filters).every(([key, set]) => {
      if (!set || set.size === 0) return true;
      const value = item[key];
      if (value === undefined || value === null || value === '') return false;
      return set.has(value);
    });
  });

  DOM.statComparables.textContent = state.comparables.length.toString();
  DOM.statFiltered.textContent = state.filtered.length.toString();

  renderComparableList();
  syncMarkers();
}

function resetAppState() {
  state.comparables = [];
  state.filtered = [];
  state.selectedCodes = new Set();
  Object.keys(state.filters).forEach((key) => {
    state.filters[key] = new Set();
  });
  DOM.fileInput.value = '';
  DOM.fileLabel.textContent = 'Seleccionar archivo';
  DOM.uploadStatus.textContent = '';
  DOM.statComparables.textContent = '0';
  DOM.statFiltered.textContent = '0';
  DOM.filtersContainer.innerHTML = '';
  DOM.comparableList.innerHTML = '';
  DOM.selectAll.disabled = true;
  DOM.selectNone.disabled = true;
  DOM.resetFilters.disabled = true;
  DOM.clearData.disabled = true;

  markerEntries.forEach((entry) => {
    markerLayer.removeLayer(entry.marker);
    labelLayer.removeLayer(entry.label);
  });
  markerEntries.clear();
}

function updateTheme(theme) {
  state.theme = theme;
  document.body.classList.toggle('theme-dark', theme === 'dark');
  document.body.classList.toggle('theme-light', theme === 'light');

  if (theme === 'dark') {
    if (map.hasLayer(baseLayers.light)) map.removeLayer(baseLayers.light);
    baseLayers.dark.addTo(map);
    DOM.toggleTheme.textContent = 'Claro';
  } else {
    if (map.hasLayer(baseLayers.dark)) map.removeLayer(baseLayers.dark);
    baseLayers.light.addTo(map);
    DOM.toggleTheme.textContent = 'Oscuro';
  }

  document.querySelectorAll('.data-label').forEach((element) => {
    element.dataset.theme = theme;
  });
}

function onFileChange(event) {
  const [file] = event.target.files;
  if (!file) return;

  DOM.fileLabel.textContent = file.name;
  DOM.uploadStatus.textContent = 'Procesando archivo…';

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    try {
      const data = new Uint8Array(loadEvent.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const preferredSheet = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'eemm');
      const sheetName = preferredSheet ?? workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('No se encontró una hoja válida en el archivo.');
      }
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: null,
        raw: false,
      });
      if (!rows.length) {
        throw new Error('La hoja seleccionada está vacía.');
      }

      state.comparables = aggregateComparables(rows);
      state.filtered = [...state.comparables];
      state.selectedCodes = new Set(state.comparables.map((item) => item.code));

      renderFilters();
      applyFilters();

      DOM.clearData.disabled = false;
      DOM.selectAll.disabled = false;
      DOM.selectNone.disabled = false;
      DOM.uploadStatus.textContent = `Se cargaron ${state.comparables.length} comparables.`;

      setTimeout(() => fitToVisibleMarkers(), 100);
    } catch (error) {
      console.error(error);
      resetAppState();
      DOM.uploadStatus.textContent = error.message || 'No se pudo procesar el archivo.';
    }
  };

  reader.onerror = () => {
    resetAppState();
    DOM.uploadStatus.textContent = 'Error al leer el archivo.';
  };

  reader.readAsArrayBuffer(file);
}

function init() {
  DOM.fileInput.addEventListener('change', onFileChange);
  DOM.clearData.addEventListener('click', () => {
    resetAppState();
    DOM.clearData.disabled = true;
  });

  DOM.resetFilters.addEventListener('click', () => {
    Object.keys(state.filters).forEach((key) => {
      state.filters[key].clear();
    });
    renderFilters();
    applyFilters();
  });

  DOM.selectAll.addEventListener('click', () => {
    state.filtered.forEach((item) => state.selectedCodes.add(item.code));
    renderComparableList();
    syncMarkers();
  });

  DOM.selectNone.addEventListener('click', () => {
    state.filtered.forEach((item) => state.selectedCodes.delete(item.code));
    renderComparableList();
    syncMarkers();
  });

  DOM.toggleMarkers.addEventListener('change', () => {
    state.markersVisible = DOM.toggleMarkers.checked;
    updateLayerVisibility();
  });

  DOM.toggleLabels.addEventListener('change', () => {
    state.labelsVisible = DOM.toggleLabels.checked;
    updateLayerVisibility();
  });

  DOM.labelScale.addEventListener('input', () => {
    const scale = Number(DOM.labelScale.value) / 100;
    document.documentElement.style.setProperty('--label-scale', scale.toString());
  });

  DOM.labelColor.addEventListener('input', () => {
    const color = DOM.labelColor.value;
    document.documentElement.style.setProperty('--label-color', color);
    markerEntries.forEach((entry) => {
      entry.marker.setStyle({ color, fillColor: color });
    });
  });

  DOM.toggleTheme.addEventListener('click', () => {
    updateTheme(state.theme === 'light' ? 'dark' : 'light');
    syncMarkers();
  });

  DOM.fitBounds.addEventListener('click', () => {
    fitToVisibleMarkers();
  });

  updateTheme('light');
  document.documentElement.style.setProperty('--label-scale', '1');
  document.documentElement.style.setProperty('--label-color', DOM.labelColor.value);
}

init();
