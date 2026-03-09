// app.js — versión completa y lista para usar
// Contiene: controles, filtros, recorte, texto (color), ajuste de lienzo y export a imagen/PDF.
// Implementa el overlay móvil y evita overflow controlando wrapper + zoom.

const INTERNAL_DEFAULT = { width: 1200, height: 800 };
let internalSize = { ...INTERNAL_DEFAULT };
let originalInternalSize = { ...INTERNAL_DEFAULT };

// Utilidades de optimización
function debounce(fn, ms) {
  let timeoutId;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
}

function throttle(fn, ms) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}


// Patch global: todos los canvas que crea Fabric internamente
// (cache, upper, lower) usan willReadFrequently=true para evitar
// el aviso de rendimiento de Chrome.
(function patchFabricCanvases() {
  // 1) Parchar el elemento canvas del editor antes de que Fabric lo inicialice
  const editorEl = document.getElementById('editor-canvas');
  if (editorEl) {
    const origGet = editorEl.getContext.bind(editorEl);
    editorEl.getContext = (type, attrs) =>
      origGet(type, Object.assign({ willReadFrequently: true }, attrs || {}));
  }

  // 2) Parchar fabric.util.createCanvasElement para TODOS los canvas internos
  //    (cache de objetos, upper canvas, canvas de filtros WebGL, etc.)
  if (window.fabric && fabric.util && fabric.util.createCanvasElement) {
    const origCreate = fabric.util.createCanvasElement;
    fabric.util.createCanvasElement = function () {
      const el = origCreate.apply(this, arguments);
      if (el && el.getContext) {
        const origCtx = el.getContext.bind(el);
        el.getContext = (type, attrs) =>
          origCtx(type, Object.assign({ willReadFrequently: true }, attrs || {}));
      }
      return el;
    };
  }
})();

// Crear canvas Fabric
const canvas = new fabric.Canvas('editor-canvas', {
  backgroundColor: '#ffffff',
  preserveObjectStacking: true,
  selection: true,
  perPixelTargetFind: true,
  targetFindTolerance: 4,
});

// Inicializar tamaño interno
canvas.setWidth(internalSize.width);
canvas.setHeight(internalSize.height);

// DOM helpers
const $ = (id) => document.getElementById(id);
const uploadBase = $('upload-base');
const uploadOverlay = $('upload-overlay');
const selectedInfo = $('selected-info');
const imageControls = $('image-controls');
const brightnessInput = $('brightness');
const contrastInput = $('contrast');
const saturationInput = $('saturation');
const opacityInput = $('opacity');
const brightnessVal = $('brightness-val');
const contrastVal = $('contrast-val');
const saturationVal = $('saturation-val');
const opacityVal = $('opacity-val');
const cropBtn = $('crop-btn');
const applyCropBtn = $('apply-crop');
const cancelCropBtn = $('cancel-crop');
let croppingRect = null;
let croppingTarget = null;

const savePngBtn = $('save-png');
const saveJpegBtn = $('save-jpeg');
const savePdfBtn = $('save-pdf');

const pdfSizeSelect = $('pdf-size');
const pdfOrientationSelect = $('pdf-orientation');
const pdfCustomDiv = $('pdf-custom-size');
const pdfCustomWidth = $('pdf-custom-width-mm');
const pdfCustomHeight = $('pdf-custom-height-mm');
const pdfFitCheckbox = $('pdf-fit');

const fitToImageBtn = $('fit-to-image-btn');
const fitToPdfBtn = $('fit-to-pdf-btn');
const restoreCanvasBtn = $('restore-canvas-btn');

const textInput = $('text-input');
const addTextBtn = $('add-text');
const textColorInput = $('text-color');

// Mobile DOM Elements
const mNavAdd = $('m-nav-add');
const mNavEdit = $('m-nav-edit');
const mNavCrop = $('m-nav-crop');
const mNavText = $('m-nav-text');
const mNavCanvas = $('m-nav-canvas');
const mNavExport = $('m-nav-export');

const mSubmenuEdit = $('m-submenu-edit');
const mSubmenuCanvas = $('m-submenu-canvas');
const mSubmenuExport = $('m-submenu-export');

const mSliderPanel = $('m-slider-panel');
const mTextPanel = $('m-text-panel');
const mDynamicSlider = $('m-dynamic-slider');
const mSliderLabel = $('m-slider-label');
const mSliderValue = $('m-slider-value');
const mTextInput = $('m-text-input');
const mTextColor = $('m-text-color');
const mTextSize = $('m-text-size');
const mPdfPanel = $('m-pdf-panel');
const mPdfSize = $('m-pdf-size');
const mPdfOrientation = $('m-pdf-orientation');
const mSavePdfBtn = $('m-save-pdf-btn');

const mContextActions = $('mobile-context-actions');
const mApplyBtn = $('mobile-apply-btn');
const mCancelBtn = $('mobile-cancel-btn');

// Topbar history / delete buttons
const btnUndo = $('btn-undo');
const btnRedo = $('btn-redo');
const btnDelete = $('btn-delete');

let activeMobileMode = null; // 'crop', 'text', 'adjustment'
let currentAdjustmentType = null;


// ================================================================
// HISTORIAL DE DESHACER / REHACER
// ================================================================
(function initHistory() {
  const MAX_HISTORY = 40;       // máximo de estados almacenados
  const historyStack = [];      // pila de snapshots JSON
  let historyIndex = -1;        // posición actual en la pila
  let isRestoring = false;      // bandera para evitar registrar cambios al restaurar

  /** Captura el estado actual del canvas y lo guarda en la pila */
  function saveSnapshot() {
    if (isRestoring) return;

    // Si estamos en modo recorte, no guardar
    if (croppingRect && croppingRect._isCropping) return;

    // Serializar el canvas completo
    const json = JSON.stringify(canvas.toJSON(['selectable', 'hasControls', 'lockRotation', '_isCropping']));

    // Si el snapshot es igual al actual (no hubo cambio real), no duplicar
    if (historyIndex >= 0 && historyStack[historyIndex] === json) return;

    // Descartar cualquier "futuro" si estamos a mitad de la pila
    historyStack.splice(historyIndex + 1);

    historyStack.push(json);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    historyIndex = historyStack.length - 1;

    refreshHistoryButtons();
  }

  /** Actualiza el estado enabled/disabled de los botones */
  function refreshHistoryButtons() {
    if (btnUndo) btnUndo.disabled = (historyIndex <= 0);
    if (btnRedo) btnRedo.disabled = (historyIndex >= historyStack.length - 1);
  }

  /** Restaura un snapshot de la pila */
  function restoreSnapshot(index) {
    if (index < 0 || index >= historyStack.length) return;
    isRestoring = true;
    const json = historyStack[index];
    canvas.loadFromJSON(json, () => {
      canvas.requestRenderAll();
      fitZoomToContainer();
      historyIndex = index;
      refreshHistoryButtons();
      // Actualizar botón delete después de restaurar
      updateDeleteBtn();
      isRestoring = false;
    });
  }

  /** Deshacer: retrocede un paso en la pila */
  window.historyUndo = function () {
    if (historyIndex > 0) restoreSnapshot(historyIndex - 1);
  };

  /** Rehacer: avanza un paso en la pila */
  window.historyRedo = function () {
    if (historyIndex < historyStack.length - 1) restoreSnapshot(historyIndex + 1);
  };

  // Exponer saveSnapshot globalmente para llamarla desde otros puntos
  window.historySave = saveSnapshot;

  // ---- Eventos del canvas que disparan guardado de historial ----
  // Usamos debounce en object:modified para no guardar en cada frame de arrastre
  const debouncedSave = debounce(saveSnapshot, 300);

  canvas.on('object:added', () => { if (!isRestoring) saveSnapshot(); });
  canvas.on('object:removed', () => { if (!isRestoring) saveSnapshot(); });
  canvas.on('object:modified', () => { if (!isRestoring) debouncedSave(); });
  canvas.on('object:scaled', () => { if (!isRestoring) debouncedSave(); });
  canvas.on('object:moved', () => { if (!isRestoring) debouncedSave(); });
  canvas.on('object:rotated', () => { if (!isRestoring) debouncedSave(); });

  // Captura inicial (lienzo vacío)
  saveSnapshot();

  // ---- Botones del topbar ----
  if (btnUndo) btnUndo.addEventListener('click', window.historyUndo);
  if (btnRedo) btnRedo.addEventListener('click', window.historyRedo);

  refreshHistoryButtons();
})();


// ================================================================
// BOTÓN ELIMINAR (contextual según selección)
// ================================================================
function updateDeleteBtn() {
  if (!btnDelete) return;
  const obj = canvas.getActiveObject();
  btnDelete.style.display = obj ? 'inline-flex' : 'none';
}

function deleteSelected() {
  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;
  if (activeObj.isEditing) return;
  if (activeObj.type === 'activeSelection') {
    activeObj.forEachObject(obj => canvas.remove(obj));
    canvas.discardActiveObject();
  } else {
    canvas.remove(activeObj);
  }
  canvas.requestRenderAll();
  updateDeleteBtn();
}

if (btnDelete) btnDelete.addEventListener('click', deleteSelected);




// resize handler: recalculate zoom on resize
const debouncedResize = debounce(() => {
  fitZoomToContainer();
}, 100);

window.addEventListener('resize', debouncedResize);


// PDF custom selector
pdfSizeSelect.addEventListener('change', () => {
  pdfCustomDiv.style.display = pdfSizeSelect.value === 'custom' ? 'block' : 'none';
});

// ---------------- Responsive: zoom + wrapper sizing ----------------
function fitZoomToContainer() {
  const container = document.getElementById('canvas-area');
  const rect = container.getBoundingClientRect();
  const headerEl = document.querySelector('.topbar');
  const headerH = headerEl ? headerEl.offsetHeight : 0;
  const availW = Math.max(120, rect.width - 16);
  const availH = Math.max(120, window.innerHeight - headerH - 40);

  // escala para que internalSize quepa en el espacio disponible
  let scale = Math.min(availW / internalSize.width, availH / internalSize.height);
  if (scale <= 0) scale = 0.1;

  // Límite de escala en móviles para evitar que el lienzo "se pierda"
  if (window.innerWidth < 900) {
    scale = Math.min(scale, 0.9);
  } else {
    scale = Math.min(scale, 1.4);
  }

  // aplicar zoom interno de fabric

  canvas.setZoom(scale);

  // ajustar tamaño del wrapper (controla layout; evita overflow)
  const wCss = Math.round(internalSize.width * scale);
  const hCss = Math.round(internalSize.height * scale);
  if (canvas.wrapperEl) {
    canvas.wrapperEl.style.width = wCss + 'px';
    canvas.wrapperEl.style.height = hCss + 'px';
    canvas.wrapperEl.style.maxWidth = '100%';
    canvas.wrapperEl.style.maxHeight = '100%';
    canvas.wrapperEl.style.boxSizing = 'border-box';
  } else if (canvas.upperCanvasEl && canvas.upperCanvasEl.parentElement) {
    // Fallback: ajustar parent if available
    const parent = canvas.upperCanvasEl.parentElement;
    parent.style.width = wCss + 'px';
    parent.style.height = hCss + 'px';
    parent.style.maxWidth = '100%';
    parent.style.maxHeight = '100%';
    parent.style.boxSizing = 'border-box';
  }

  // Los elementos canvas deben tomar 100% del wrapper para no expandir layout
  if (canvas.upperCanvasEl) {
    canvas.upperCanvasEl.style.width = '100%';
    canvas.upperCanvasEl.style.height = '100%';
    canvas.upperCanvasEl.style.display = 'block';
  }
  if (canvas.lowerCanvasEl) {
    canvas.lowerCanvasEl.style.width = '100%';
    canvas.lowerCanvasEl.style.height = '100%';
    canvas.lowerCanvasEl.style.display = 'block';
  }

  // Ajuste de offset para eventos de mouse/touch
  canvas.calcOffset();
}
fitZoomToContainer();

// ---------------- Filtros y utilidades ----------------
const pagePresetsMm = {
  a4: { w: 210, h: 297 },
  letter: { w: 216, h: 279 },
  legal: { w: 216, h: 356 },
  a3: { w: 297, h: 420 },
};

function mapFilter(val, min = -1, max = 1) {
  return (val / 100) * (max - min);
}

function ensureFilters(imgObj) {
  if (!imgObj.filters) imgObj.filters = [];
  const F = fabric.Image.filters;
  let hasBrightness = imgObj.filters.find(f => f && f.type === 'Brightness');
  let hasContrast = imgObj.filters.find(f => f && f.type === 'Contrast');
  let hasSaturation = imgObj.filters.find(f => f && f.type === 'Saturation');
  let hasHue = imgObj.filters.find(f => f && f.type === 'HueRotation');
  let hasBlur = imgObj.filters.find(f => f && f.type === 'Blur');
  let hasPixel = imgObj.filters.find(f => f && f.type === 'Pixelate');

  if (!hasBrightness) imgObj.filters.push(new F.Brightness({ brightness: 0 }));
  if (!hasContrast) imgObj.filters.push(new F.Contrast({ contrast: 0 }));
  if (!hasSaturation) imgObj.filters.push(new F.Saturation({ saturation: 0 }));
  if (!hasHue) imgObj.filters.push(new F.HueRotation({ rotation: 0 }));
  if (!hasBlur) imgObj.filters.push(new F.Blur({ blur: 0 }));
  if (!hasPixel) imgObj.filters.push(new F.Pixelate({ blocksize: 1 }));

  imgObj.applyFilters();
}

function updateSlidersFromObject(obj) {
  if (!obj || obj.type !== 'image') return;
  ensureFilters(obj);
  const f = obj.filters;
  const brightness = f.find(f => f && f.type === 'Brightness');
  const contrast = f.find(f => f && f.type === 'Contrast');
  const saturation = f.find(f => f && f.type === 'Saturation');
  brightnessInput.value = Math.round((brightness?.brightness ?? 0) * 100);
  contrastInput.value = Math.round((contrast?.contrast ?? 0) * 100);
  saturationInput.value = Math.round((saturation?.saturation ?? 0) * 100);
  opacityInput.value = Math.round((obj.opacity ?? 1) * 100);
  brightnessVal.textContent = brightnessInput.value;
  contrastVal.textContent = contrastInput.value;
  saturationVal.textContent = saturationInput.value;
  opacityVal.textContent = opacityInput.value;
}

// Throttled version of applying filters for better performance
const throttledApplyFilters = throttle((obj) => {
  if (!obj || obj.type !== 'image') return;
  obj.applyFilters();
  canvas.requestRenderAll();
}, 60);

function applySlidersToObject(obj) {
  if (!obj || obj.type !== 'image') return;
  ensureFilters(obj);
  const f = obj.filters;
  const brightness = f.find(f => f && f.type === 'Brightness');
  const contrast = f.find(f => f && f.type === 'Contrast');
  const saturation = f.find(f => f && f.type === 'Saturation');

  brightness.brightness = mapFilter(parseInt(brightnessInput.value));
  contrast.contrast = mapFilter(parseInt(contrastInput.value));
  saturation.saturation = parseInt(saturationInput.value) / 100;
  obj.opacity = parseInt(opacityInput.value) / 100;

  throttledApplyFilters(obj);
}


// ---------------- Carga de imágenes ----------------
// Usamos FileReader (data: URL) en lugar de createObjectURL (blob: URL)
// para que los snapshots del historial puedan recargar las imágenes.
function loadFileAsDataURL(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => callback(e.target.result);
  reader.readAsDataURL(file);
}

uploadBase.addEventListener('change', (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  loadFileAsDataURL(file, (dataUrl) => {
    fabric.Image.fromURL(dataUrl, function (img) {
      img.set({ left: internalSize.width / 2, top: internalSize.height / 2, originX: 'center', originY: 'center', selectable: true, hasControls: true });
      const maxW = internalSize.width * 0.95, maxH = internalSize.height * 0.95;
      const fitScale = Math.min(maxW / img.width, maxH / img.height);
      let scale = (isFinite(fitScale) && fitScale > 0) ? Math.min(fitScale, 2) : 1;
      img.scale(scale);
      canvas.add(img).setActiveObject(img);
      canvas.requestRenderAll();
      try {
        fitCanvasToSelectedImage();
      } catch (e) { }
      fitZoomToContainer();
    });
  });
  ev.target.value = '';
});

uploadOverlay.addEventListener('change', (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  loadFileAsDataURL(file, (dataUrl) => {
    fabric.Image.fromURL(dataUrl, function (img) {
      img.set({ left: internalSize.width / 2 + 40, top: internalSize.height / 2 + 40, originX: 'center', originY: 'center', selectable: true, hasControls: true });
      const maxW = internalSize.width * 0.9, maxH = internalSize.height * 0.9;
      const fitScale = Math.min(maxW / img.width, maxH / img.height);
      let scale = (isFinite(fitScale) && fitScale > 0) ? Math.min(fitScale, 1.5) : 1;
      img.scale(scale);
      canvas.add(img).setActiveObject(img);
      canvas.requestRenderAll();
      fitZoomToContainer();
    });
  });
  ev.target.value = '';
});

// ---------------- Selección y texto ----------------
canvas.on('selection:created', (e) => { updateSelected(e); updateDeleteBtn(); });
canvas.on('selection:updated', (e) => { updateSelected(e); updateDeleteBtn(); });
canvas.on('selection:cleared', () => {
  selectedInfo.textContent = 'Ninguno';
  imageControls.style.display = 'none';
  updateDeleteBtn();
});

canvas.on('mouse:dblclick', function (opt) {
  const target = opt.target;
  if (target && (target.type === 'textbox' || target.type === 'text')) {
    canvas.setActiveObject(target);
    target.enterEditing();
  }
});

function updateSelected(e) {
  let obj = e.selected ? e.selected[0] : e.target;
  if (!obj) return;
  canvas.setActiveObject(obj);
  selectedInfo.textContent = obj.type;
  if (obj.type === 'image') {
    imageControls.style.display = 'block';
    updateSlidersFromObject(obj);
  } else {
    imageControls.style.display = 'none';
  }
  if (obj.type === 'textbox' || obj.type === 'text') {
    try { textColorInput.value = rgbToHex(obj.fill || '#111111'); } catch (e) { }
  }
}

[brightnessInput, contrastInput, saturationInput, opacityInput].forEach(el => {
  el.addEventListener('input', () => {
    brightnessVal.textContent = brightnessInput.value;
    contrastVal.textContent = contrastInput.value;
    saturationVal.textContent = saturationInput.value;
    opacityVal.textContent = opacityInput.value;
    const obj = canvas.getActiveObject();
    if (obj && obj.type === 'image') applySlidersToObject(obj);
  });
});

// Añadir texto con color
addTextBtn.addEventListener('click', () => {
  const txt = textInput.value || 'Texto';
  const color = textColorInput.value || '#111111';
  // tamaño de fuente relativo al canvas (p.ej. 5% del menor lado), ancho del textbox proporcional
  const computedFont = Math.max(12, Math.round(Math.min(internalSize.width, internalSize.height) * 0.05));
  const textboxWidth = Math.round(internalSize.width * 0.6);
  const textbox = new fabric.Textbox(txt, {
    left: internalSize.width / 2,
    top: internalSize.height / 2,
    originX: 'center',
    originY: 'center',
    fontSize: computedFont,
    width: textboxWidth,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 'bold',
    textAlign: 'center',

    fill: color,
    editable: true,
    objectCaching: false,
  });
  canvas.add(textbox).setActiveObject(textbox);
  // si se desea ajustar finamente el tamaño del texto al ancho disponible
  try { scaleTextToFit(textbox, textboxWidth, internalSize.height * 0.35); } catch (e) { }
  canvas.requestRenderAll();
  textInput.value = '';
});

// Cambiar color en textbox seleccionado
textColorInput.addEventListener('input', () => {
  const color = textColorInput.value;
  const obj = canvas.getActiveObject();
  if (obj && (obj.type === 'textbox' || obj.type === 'text')) {
    obj.set('fill', color);
    canvas.requestRenderAll();
  }
});

function rgbToHex(input) {
  if (!input) return '#000000';
  if (typeof input === 'string' && input[0] === '#') return input;
  const m = input.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/i);
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, '0');
    const g = parseInt(m[2]).toString(16).padStart(2, '0');
    const b = parseInt(m[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#111111';
}

// ---------------- Crop ----------------
cropBtn.addEventListener('click', () => {
  const obj = canvas.getActiveObject();
  if (!obj || obj.type !== 'image') { alert('Selecciona una imagen para recortar.'); return; }
  croppingTarget = obj;

  // Obtener límites en coordenadas del mundo (sin zoom) para crear un rect preciso
  const bound = obj.getBoundingRect(false);

  croppingRect = new fabric.Rect({
    left: bound.left + (bound.width * 0.1),
    top: bound.top + (bound.height * 0.1),
    width: bound.width * 0.8,
    height: bound.height * 0.8,
    fill: 'rgba(0,0,0,0.15)',
    stroke: '#2b7cff',
    strokeWidth: 2,
    selectable: true,
    hasRotatingPoint: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#2b7cff',
    transparentCorners: false,
    cornerStyle: 'rect',
    cornerSize: window.innerWidth < 900 ? 30 : 18,
    lockRotation: true,
    hasBorders: true,
    borderDashArray: [5, 5]
  });


  croppingRect.setControlsVisibility({ mtr: false });
  canvas.add(croppingRect);
  croppingRect.moveTo(canvas.getObjects().length - 1);
  applyCropBtn.style.display = 'inline-block';
  cancelCropBtn.style.display = 'inline-block';
  // bloquear scroll/overflow para mejorar la experiencia táctil mientras se recorta
  document.body.style.overflow = 'hidden';
  // marcar que estamos en modo recorte
  croppingRect._isCropping = true;
});

// Función centralizada de recorte
function performCrop() {
  if (!croppingRect || !croppingTarget) return;

  try {
    const rect = croppingRect;
    const target = croppingTarget;

    // 1. Obtener la caja delimitadora del rect de recorte
    const rectBound = rect.getBoundingRect(true);

    // 2. Convertir esa caja a coordenadas RELATIVAS al objeto imagen (target)
    // Usamos el 'untransformed' bounding box de la imagen para calcular el ratio
    const imgBound = target.getBoundingRect(true);

    // Cálculo de la sub-región de la imagen original a extraer
    // Necesitamos saber cuánto del objeto original (sin escala) representa el cuadro azul
    const scaleX = target.scaleX;
    const scaleY = target.scaleY;

    const cropLeft = (rectBound.left - imgBound.left) / scaleX;
    const cropTop = (rectBound.top - imgBound.top) / scaleY;
    const cropWidth = rectBound.width / scaleX;
    const cropHeight = rectBound.height / scaleY;

    // Usar el método nativo del objeto imagen para extraer esa zona con toDataURL
    const dataUrl = target.toDataURL({
      left: cropLeft * target.scaleX,
      top: cropTop * target.scaleY,
      width: cropWidth * target.scaleX,
      height: cropHeight * target.scaleY,
      format: 'png',
      quality: 1
    });

    fabric.Image.fromURL(dataUrl, function (newImg) {
      if (!newImg) return;

      newImg.set({
        left: rectBound.left + rectBound.width / 2,
        top: rectBound.top + rectBound.height / 2,
        originX: 'center',
        originY: 'center',
        selectable: true,
        opacity: target.opacity,
        angle: target.angle
      });

      // Ajustar escala si es necesario para mantener tamaño visual
      newImg.scaleToWidth(rectBound.width);

      canvas.remove(target);
      canvas.remove(rect);

      croppingRect = null;
      croppingTarget = null;

      applyCropBtn.style.display = 'none';
      cancelCropBtn.style.display = 'none';
      document.body.style.overflow = '';

      canvas.add(newImg).setActiveObject(newImg);
      canvas.requestRenderAll();
    });
  } catch (e) {
    console.error("Error during crop:", e);
    cancelCrop();
  }
}


applyCropBtn.addEventListener('click', performCrop);


cancelCropBtn.addEventListener('click', cancelCrop);
function cancelCrop() {
  if (croppingRect) canvas.remove(croppingRect);
  croppingRect = null; croppingTarget = null;
  applyCropBtn.style.display = 'none'; cancelCropBtn.style.display = 'none';
  // restaurar scroll si se canceló el recorte
  document.body.style.overflow = '';
  canvas.requestRenderAll();
}

// ---------------- Export ----------------
function exportImage(format = 'png', quality = 1.0) {
  canvas.discardActiveObject();
  canvas.renderAll();

  // Limitar el multiplicador si el canvas ya es muy grande para evitar bloqueos por memoria
  let multiplier = 2;
  const area = internalSize.width * internalSize.height;
  if (area > 2000 * 2000) multiplier = 1.5;
  if (area > 4000 * 4000) multiplier = 1;

  return canvas.toDataURL({ format: format, quality: quality, multiplier: multiplier });
}


savePngBtn.addEventListener('click', () => { const url = exportImage('png'); downloadDataURL(url, `edicion-${Date.now()}.png`); });
saveJpegBtn.addEventListener('click', () => { const url = exportImage('jpeg', 0.92); downloadDataURL(url, `edicion-${Date.now()}.jpg`); });
function downloadDataURL(dataURL, filename) { const a = document.createElement('a'); a.href = dataURL; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }

savePdfBtn.addEventListener('click', async () => {
  const { jsPDF } = window.jspdf;
  const dataURL = exportImage('png');
  const img = new Image();
  img.onload = function () {
    let pageWmm, pageHmm;
    if (pdfSizeSelect.value === 'canvas') {
      const pxToMm = 0.264583;
      pageWmm = internalSize.width * pxToMm;
      pageHmm = internalSize.height * pxToMm;
    } else if (pdfSizeSelect.value === 'custom') {
      pageWmm = parseFloat(pdfCustomWidth.value) || 210;
      pageHmm = parseFloat(pdfCustomHeight.value) || 297;
    } else {
      const preset = pagePresetsMm[pdfSizeSelect.value] || pagePresetsMm.a4;
      pageWmm = preset.w; pageHmm = preset.h;
    }
    const orientation = pdfOrientationSelect.value === 'landscape' ? 'landscape' : 'portrait';
    if (orientation === 'landscape') { const tmp = pageWmm; pageWmm = pageHmm; pageHmm = tmp; }
    const marginMm = 10;
    const availW = Math.max(1, pageWmm - 2 * marginMm); const availH = Math.max(1, pageHmm - 2 * marginMm);
    const scaleMmPerPx = Math.min(availW / img.width, availH / img.height);
    let displayWmm, displayHmm;
    if (pdfFitCheckbox.checked) { displayWmm = img.width * scaleMmPerPx; displayHmm = img.height * scaleMmPerPx; }
    else {
      const pxToMm = 0.264583;
      displayWmm = img.width * pxToMm; displayHmm = img.height * pxToMm;
      if (displayWmm > availW || displayHmm > availH) {
        const scaleReduce = Math.min(availW / displayWmm, availH / displayHmm);
        displayWmm *= scaleReduce; displayHmm *= scaleReduce;
      }
    }
    const x = (pageWmm - displayWmm) / 2; const y = (pageHmm - displayHmm) / 2;
    const pdf = new jsPDF({ orientation: orientation, unit: 'mm', format: [pageWmm, pageHmm] });
    pdf.addImage(dataURL, 'PNG', x, y, displayWmm, displayHmm);
    pdf.save(`edicion-${Date.now()}.pdf`);
  };
  img.src = dataURL;
});

// Función auxiliar para centrar todo el contenido en el nuevo tamaño de lienzo
function centerAllContent(targetWidth, targetHeight) {
  const objects = canvas.getObjects().filter(o => !o._isCropping);
  if (objects.length === 0) return;

  const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  objects.forEach(obj => {
    const br = obj.getBoundingRect();
    const x1 = (br.left - vpt[4]) / vpt[0];
    const y1 = (br.top - vpt[5]) / vpt[3];
    const x2 = (br.left + br.width - vpt[4]) / vpt[0];
    const y2 = (br.top + br.height - vpt[5]) / vpt[3];

    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  });

  if (!isFinite(minX)) return;

  const contentW = maxX - minX;
  const contentH = maxY - minY;

  const dx = (targetWidth - contentW) / 2 - minX;
  const dy = (targetHeight - contentH) / 2 - minY;

  objects.forEach(o => {
    o.set({
      left: (o.left || 0) + dx,
      top: (o.top || 0) + dy
    });
    o.setCoords();
  });
}



// ---------------- Ajustes de lienzo (internal size + zoom) ----------------
function fitCanvasToSelectedImage(padding = 40) {
  const obj = canvas.getActiveObject();
  if (!obj || obj.type !== 'image') {
    alert('Selecciona una imagen para ajustar el lienzo.');
    return;
  }

  const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  const br = obj.getBoundingRect();
  const wl = (br.left - vpt[4]) / vpt[0];
  const wt = (br.top - vpt[5]) / vpt[3];
  const ww = br.width / vpt[0];
  const wh = br.height / vpt[3];

  const targetW = Math.round(ww + padding * 2);
  const targetH = Math.round(wh + padding * 2);

  const dx = padding - wl;
  const dy = padding - wt;


  internalSize.width = Math.max(100, targetW);
  internalSize.height = Math.max(100, targetH);

  canvas.setWidth(internalSize.width);
  canvas.setHeight(internalSize.height);

  canvas.getObjects().forEach(o => {
    o.set({ left: (o.left || 0) + dx, top: (o.top || 0) + dy });
    o.setCoords();
  });

  canvas.discardActiveObject();
  canvas.requestRenderAll();
  fitZoomToContainer();
  canvas.calcOffset();
  canvas.setActiveObject(obj);
}

function fitCanvasToAllObjects(padding = 40) {
  const objects = canvas.getObjects();
  if (objects.length === 0) return;

  const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  objects.forEach(obj => {
    const br = obj.getBoundingRect();
    const x1 = (br.left - vpt[4]) / vpt[0];
    const y1 = (br.top - vpt[5]) / vpt[3];
    const x2 = (br.left + br.width - vpt[4]) / vpt[0];
    const y2 = (br.top + br.height - vpt[5]) / vpt[3];

    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  });

  if (!isFinite(minX)) return;


  const targetW = Math.round((maxX - minX) + padding * 2);
  const targetH = Math.round((maxY - minY) + padding * 2);

  const dx = padding - minX;
  const dy = padding - minY;

  internalSize.width = Math.max(100, targetW);
  internalSize.height = Math.max(100, targetH);

  canvas.setWidth(internalSize.width);
  canvas.setHeight(internalSize.height);

  objects.forEach(o => {
    o.set({ left: (o.left || 0) + dx, top: (o.top || 0) + dy });
    o.setCoords();
  });

  canvas.requestRenderAll();
  fitZoomToContainer();
  canvas.calcOffset();
}


function fitCanvasToPdfPage(paddingMm = 10) {
  let pageWmm, pageHmm;
  if (pdfSizeSelect.value === 'canvas') {
    const pxToMm = 0.264583;
    pageWmm = internalSize.width * pxToMm;
    pageHmm = internalSize.height * pxToMm;
  } else if (pdfSizeSelect.value === 'custom') {
    pageWmm = parseFloat(pdfCustomWidth.value) || 210;
    pageHmm = parseFloat(pdfCustomHeight.value) || 297;
  } else {
    const preset = pagePresetsMm[pdfSizeSelect.value] || pagePresetsMm.a4;
    pageWmm = preset.w; pageHmm = preset.h;
  }

  if (pdfOrientationSelect.value === 'landscape') {
    const tmp = pageWmm; pageWmm = pageHmm; pageHmm = tmp;
  }

  const pxPerMm = 1 / 0.264583;
  let targetWpx = Math.round(pageWmm * pxPerMm);
  let targetHpx = Math.round(pageHmm * pxPerMm);

  internalSize.width = Math.min(Math.max(100, targetWpx), 4000);
  internalSize.height = Math.min(Math.max(100, targetHpx), 4000);

  // CENTRAR AUTOMÁTICAMENTE EL CONTENIDO EXISTENTE
  centerAllContent(internalSize.width, internalSize.height);

  canvas.setWidth(internalSize.width);
  canvas.setHeight(internalSize.height);

  canvas.requestRenderAll();
  fitZoomToContainer();
  canvas.calcOffset();
}


function restoreOriginalCanvasSize() {
  internalSize = { ...originalInternalSize };

  centerAllContent(internalSize.width, internalSize.height);

  canvas.setWidth(internalSize.width);
  canvas.setHeight(internalSize.height);

  canvas.requestRenderAll();
  fitZoomToContainer();
  canvas.calcOffset();
}



fitToImageBtn.addEventListener('click', () => fitCanvasToSelectedImage());
fitToPdfBtn.addEventListener('click', () => fitCanvasToPdfPage());
restoreCanvasBtn.addEventListener('click', () => restoreOriginalCanvasSize());

// Inicial
fitZoomToContainer();

// Teclas: delete/backspace + Ctrl+Z / Ctrl+Y
document.addEventListener('keydown', (e) => {
  // Ctrl+Z = Deshacer
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (typeof window.historyUndo === 'function') window.historyUndo();
    return;
  }
  // Ctrl+Y o Ctrl+Shift+Z = Rehacer
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    if (typeof window.historyRedo === 'function') window.historyRedo();
    return;
  }

  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;

  // No borrar si el usuario está editando texto dentro del canvas o en un input real
  if (activeObj.isEditing) return;

  const target = e.target;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected();
  }
});


// ---------------- Utilidades de escalado (opcional) ----------------
function scaleObjectToFit(obj, maxW, maxH) {
  if (!obj) return;
  const naturalW = obj.width || (obj._element ? (obj._element.naturalWidth || obj._element.width) : obj.getScaledWidth());
  const naturalH = obj.height || (obj._element ? (obj._element.naturalHeight || obj._element.height) : obj.getScaledHeight());
  if (!naturalW || !naturalH) return;
  const scale = Math.min(maxW / naturalW, maxH / naturalH);
  if (isFinite(scale) && scale > 0) {
    obj.scale(scale);
    obj.setCoords();
    canvas.requestRenderAll();
  }
}

function scaleTextToFit(textObj, maxW, maxH) {
  if (!textObj || !textObj.text) return;
  // simple heurística: calcula fontSize en función del ancho disponible y longitud de texto
  const avgCharWidth = 0.6; // aproximación en em del ancho medio por carácter
  let guess = Math.round((maxW / Math.max(1, textObj.text.length)) / avgCharWidth);
  guess = Math.min(guess, Math.round(maxH));
  guess = Math.max(12, guess);
  textObj.set('fontSize', guess);
  textObj.setCoords();
  canvas.requestRenderAll();
}

// ---------------- Mobile Bottom Nav Logic ----------------

function hideAllMobilePanels() {
  const panels = [mSubmenuEdit, mSubmenuCanvas, mSubmenuExport, mSliderPanel, mTextPanel, mPdfPanel];
  panels.forEach(p => { if (p) p.style.display = 'none'; });

  // Ocultar botones de cabecera usando clase
  if (mContextActions) mContextActions.classList.remove('active');

  // Limpiar recorte si se cancela o se cambia de herramienta sin aplicar
  if (croppingRect && croppingRect._isCropping) {
    cancelCrop(); // Usa la función existente para limpiar el estado de recorte
  }

  document.body.style.overflow = '';
  activeMobileMode = null;
}



// Global click to close popups when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-item') && !e.target.closest('.m-popup') && !e.target.closest('.floating-panel') && !e.target.closest('.topbar')) {
    hideAllMobilePanels();
  }
}, true);

// Setup Mobile Listeners only if elements exist
if (mNavAdd) {
  mNavAdd.addEventListener('click', () => {
    uploadOverlay.click();
    hideAllMobilePanels();
  });
}

if (mNavEdit) {
  mNavEdit.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasVisible = mSubmenuEdit && mSubmenuEdit.style.display === 'flex';
    hideAllMobilePanels();
    if (mSubmenuEdit && !wasVisible) mSubmenuEdit.style.display = 'flex';
  });
}

if (mSubmenuEdit) {
  mSubmenuEdit.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-action');
      const dataType = btn.getAttribute('data-type');
      const obj = canvas.getActiveObject();
      if (!obj) { alert('Selecciona un objeto primero.'); return; }

      hideAllMobilePanels();

      // Acciones directas o toggles
      if (dataType === 'action' || dataType === 'toggle') {
        if (dataType === 'action') {
          if (type === 'flip-x') obj.set('flipX', !obj.flipX);
          else if (type === 'flip-y') obj.set('flipY', !obj.flipY);
          else if (type === 'rotate-90') obj.rotate((obj.angle || 0) + 90);
          else if (type === 'duplicate') {
            obj.clone((cloned) => {
              cloned.set({ left: obj.left + 20, top: obj.top + 20 });
              canvas.add(cloned);
              canvas.setActiveObject(cloned);
              canvas.requestRenderAll();
              if (window.historySave) window.historySave();
            });
            return;
          }
          else if (type === 'bring-forward') canvas.bringForward(obj);
          else if (type === 'send-backward') canvas.sendBackwards(obj);

          obj.setCoords();
          canvas.requestRenderAll();
          if (window.historySave) window.historySave();
        } else if (dataType === 'toggle') {
          if (obj.type !== 'image') { alert('Selececciona una imagen.'); return; }
          const F = fabric.Image.filters;
          if (!obj.filters) obj.filters = [];

          const filterClasses = { sepia: F.Sepia, grayscale: F.Grayscale, invert: F.Invert, sharpen: F.Convolute };
          const filterName = type === 'sharpen' ? 'Convolute' : (type.charAt(0).toUpperCase() + type.slice(1));
          const existingIdx = obj.filters.findIndex(f => f && f.type === filterName);

          if (existingIdx > -1) {
            obj.filters.splice(existingIdx, 1);
          } else {
            if (type === 'sharpen') {
              obj.filters.push(new F.Convolute({ matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0] }));
            } else if (filterClasses[type]) {
              obj.filters.push(new filterClasses[type]());
            }
          }
          obj.applyFilters();
          canvas.requestRenderAll();
          if (window.historySave) window.historySave();
        }
        return;
      }

      // Si no es action/toggle, es un ajuste con slider
      if (obj.type !== 'image') { alert('Selecciona una imagen primero.'); return; }

      currentAdjustmentType = type;
      if (mSliderPanel) mSliderPanel.style.display = 'block';
      if (mSliderLabel) mSliderLabel.textContent = btn.textContent;

      ensureFilters(obj);
      const f = obj.filters;
      const b = f.find(f => f && f.type === 'Brightness');
      const c = f.find(f => f && f.type === 'Contrast');
      const s = f.find(f => f && f.type === 'Saturation');
      const hue = f.find(f => f && f.type === 'HueRotation');
      const blur = f.find(f => f && f.type === 'Blur');
      const pixel = f.find(f => f && f.type === 'Pixelate');

      if (type === 'brightness' && mDynamicSlider) {
        mDynamicSlider.min = -100; mDynamicSlider.max = 100;
        mDynamicSlider.value = Math.round((b?.brightness ?? 0) * 100);
      } else if (type === 'contrast' && mDynamicSlider) {
        mDynamicSlider.min = -100; mDynamicSlider.max = 100;
        mDynamicSlider.value = Math.round((c?.contrast ?? 0) * 100);
      } else if (type === 'saturation' && mDynamicSlider) {
        mDynamicSlider.min = -100; mDynamicSlider.max = 100;
        mDynamicSlider.value = Math.round((s?.saturation ?? 0) * 100);
      } else if (type === 'opacity' && mDynamicSlider) {
        mDynamicSlider.min = 0; mDynamicSlider.max = 100;
        mDynamicSlider.value = Math.round((obj.opacity ?? 1) * 100);
      } else if (type === 'hue' && mDynamicSlider) {
        mDynamicSlider.min = -100; mDynamicSlider.max = 100;
        mDynamicSlider.value = Math.round((hue?.rotation ?? 0) * 50);
      } else if (type === 'blur' && mDynamicSlider) {
        mDynamicSlider.min = 0; mDynamicSlider.max = 100;
        mDynamicSlider.value = Math.round((blur?.blur ?? 0) * 100);
      } else if (type === 'pixelate' && mDynamicSlider) {
        mDynamicSlider.min = 1; mDynamicSlider.max = 100;
        mDynamicSlider.value = pixel?.blocksize ?? 1;
      }

      if (mSliderValue && mDynamicSlider) mSliderValue.textContent = mDynamicSlider.value;
    });
  });
}

if (mDynamicSlider) {
  mDynamicSlider.addEventListener('input', () => {
    if (mSliderValue) mSliderValue.textContent = mDynamicSlider.value;
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'image') return;

    ensureFilters(obj); // asegurarse que existen los filtros dinámicos
    const f = obj.filters;
    const val = parseInt(mDynamicSlider.value);

    if (currentAdjustmentType === 'brightness') {
      const filter = f.find(f => f && f.type === 'Brightness');
      if (filter) filter.brightness = mapFilter(val);
    } else if (currentAdjustmentType === 'contrast') {
      const filter = f.find(f => f && f.type === 'Contrast');
      if (filter) filter.contrast = mapFilter(val);
    } else if (currentAdjustmentType === 'saturation') {
      const filter = f.find(f => f && f.type === 'Saturation');
      if (filter) filter.saturation = val / 100;
    } else if (currentAdjustmentType === 'opacity') {
      obj.opacity = val / 100;
    } else if (currentAdjustmentType === 'hue') {
      const filter = f.find(f => f && f.type === 'HueRotation');
      if (filter) filter.rotation = val / 50;
    } else if (currentAdjustmentType === 'blur') {
      const filter = f.find(f => f && f.type === 'Blur');
      if (filter) filter.blur = val / 100;
    } else if (currentAdjustmentType === 'pixelate') {
      const filter = f.find(f => f && f.type === 'Pixelate');
      if (filter) filter.blocksize = Math.max(1, val);
    }

    throttledApplyFilters(obj);
  });
}

if (mNavCrop) {
  mNavCrop.addEventListener('click', () => {
    hideAllMobilePanels();
    cropBtn.click();
    if (croppingRect) {
      activeMobileMode = 'crop';
      if (mContextActions) mContextActions.classList.add('active');
    }
  });
}

if (mNavText) {
  mNavText.addEventListener('click', () => {
    hideAllMobilePanels();
    if (mTextPanel) mTextPanel.style.display = 'block';
    if (mContextActions) mContextActions.classList.add('active');
    activeMobileMode = 'text';
    if (mTextInput) mTextInput.focus();
  });
}


if (mNavCanvas) {
  mNavCanvas.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasVisible = mSubmenuCanvas && mSubmenuCanvas.style.display === 'flex';
    hideAllMobilePanels();
    if (mSubmenuCanvas && !wasVisible) mSubmenuCanvas.style.display = 'flex';
  });
}

if (mSubmenuCanvas) {

  mSubmenuCanvas.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'fit-image') {
        fitToImageBtn.click();
      } else if (action === 'fit-page') {
        fitToPdfBtn.click();
      } else if (['a4', 'letter', 'legal'].includes(action)) {
        // Ajustar selectores principales para que fitToPdfBtn use el tamaño elegido
        pdfSizeSelect.value = action;
        fitToPdfBtn.click();
      } else if (action === 'restore') {
        restoreCanvasBtn.click();
      }
      hideAllMobilePanels();
    });
  });
}

if (mNavExport) {
  mNavExport.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasVisible = mSubmenuExport && mSubmenuExport.style.display === 'flex';
    hideAllMobilePanels();
    if (mSubmenuExport && !wasVisible) mSubmenuExport.style.display = 'flex';
  });
}

if (mSubmenuExport) {
  mSubmenuExport.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'png') savePngBtn.click();
      else if (action === 'jpg') saveJpegBtn.click();
      else if (action === 'pdf') {
        savePdfBtn.click();
      }
      hideAllMobilePanels();
    });
  });
}


if (mSavePdfBtn) {
  mSavePdfBtn.addEventListener('click', () => {
    // Sincronizar selectores móviles con los principales (que app.js usa)
    pdfSizeSelect.value = mPdfSize.value;
    pdfOrientationSelect.value = mPdfOrientation.value;
    savePdfBtn.click();
    hideAllMobilePanels();
  });
}

if (mApplyBtn) {
  mApplyBtn.addEventListener('click', async () => {
    console.log('DEBUG: Mobile Apply button clicked. Mode:', activeMobileMode);
    if (activeMobileMode === 'crop') {
      await performCrop();
      // Once applied, clean up UI
      activeMobileMode = null;
      hideAllMobilePanels();
    } else if (activeMobileMode === 'text') {
      // Lógica de texto...
      const txt = (mTextInput && mTextInput.value) || 'Texto';
      const color = (mTextColor && mTextColor.value) || '#111111';
      const size = parseInt(mTextSize.value) || 40;

      const textbox = new fabric.Textbox(txt, {
        left: internalSize.width / 2,
        top: internalSize.height / 2,
        originX: 'center',
        originY: 'center',
        fontSize: size,
        width: Math.round(internalSize.width * 0.7),
        textAlign: 'center',
        fill: color,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 'bold'
      });
      canvas.add(textbox).setActiveObject(textbox);
      canvas.requestRenderAll();
      if (mTextInput) mTextInput.value = '';
      hideAllMobilePanels();
    }
  });
}


if (mCancelBtn) {
  mCancelBtn.addEventListener('click', () => {
    console.log('DEBUG: Mobile Cancel button clicked.');
    hideAllMobilePanels();
  });
}

document.querySelectorAll('.close-panel').forEach(btn => {
  btn.addEventListener('click', hideAllMobilePanels);
});


// ================================================================
// PINCH-TO-SCALE — Escalar objetos del lienzo con pellizco o
// Ctrl+rueda del ratón (trackpad pinch en escritorio).
// ================================================================

(function initPinchToScale() {

  // ------- HUD: indicador de escala flotante -------
  const hud = document.createElement('div');
  hud.id = 'pinch-hud';
  Object.assign(hud.style, {
    position: 'fixed',
    background: 'rgba(0,0,0,0.65)',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '700',
    fontFamily: 'Inter, sans-serif',
    pointerEvents: 'none',
    zIndex: '2000',
    opacity: '0',
    transition: 'opacity 0.2s ease',
    whiteSpace: 'nowrap',
    backdropFilter: 'blur(4px)',
    letterSpacing: '0.5px',
  });
  document.body.appendChild(hud);

  let hudTimeout = null;
  function showHud(text, x, y) {
    hud.textContent = text;
    hud.style.left = (x - hud.offsetWidth / 2) + 'px';
    hud.style.top = (y - 48) + 'px';
    hud.style.opacity = '1';
    clearTimeout(hudTimeout);
  }
  function hideHud() {
    hudTimeout = setTimeout(() => { hud.style.opacity = '0'; }, 600);
  }

  // ------- Estado del gesto -------
  let pinchTarget = null;       // objeto Fabric que se está escalando
  let pinchStartDist = 0;       // distancia inicial entre los dos dedos
  let pinchStartScaleX = 1;     // scaleX del objeto al inicio del gesto
  let pinchStartScaleY = 1;     // scaleY del objeto al inicio del gesto
  let pinchMidX = 0;            // punto medio del gesto (para el HUD)
  let pinchMidY = 0;

  // Distancia euclidiana entre dos touch points
  function touchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Punto medio entre dos touch points (en coordenadas de ventana)
  function touchMid(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
  }

  // Obtener el objeto Fabric bajo un punto de pantalla
  function getFabricObjectAt(clientX, clientY) {
    const canvasEl = canvas.upperCanvasEl || canvas.lowerCanvasEl;
    const rect = canvasEl.getBoundingClientRect();
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    // coordenadas en el espacio interno del canvas
    const fx = ((clientX - rect.left) / zoom) - vpt[4] / zoom;
    const fy = ((clientY - rect.top) / zoom) - vpt[5] / zoom;
    return canvas.findTarget({ clientX, clientY }, false)
      || canvas.getActiveObject()
      || null;
  }

  // ---------- TOUCH EVENTS ----------
  const canvasWrapEl = document.getElementById('canvas-wrapper');

  canvasWrapEl.addEventListener('touchstart', (e) => {
    // Ignorar si estamos en modo recorte
    if (croppingRect && croppingRect._isCropping) return;
    if (e.touches.length !== 2) return;

    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const mid = touchMid(t1, t2);

    pinchStartDist = touchDist(t1, t2);
    pinchMidX = mid.x;
    pinchMidY = mid.y;

    // Intentar seleccionar un objeto bajo el punto medio
    let target = canvas.getActiveObject();
    if (!target) {
      target = getFabricObjectAt(mid.x, mid.y);
      if (target) canvas.setActiveObject(target);
    }
    pinchTarget = target;

    if (pinchTarget) {
      pinchStartScaleX = pinchTarget.scaleX || 1;
      pinchStartScaleY = pinchTarget.scaleY || 1;
      showHud(`${Math.round(pinchStartScaleX * 100)}%`, mid.x, mid.y);
    }
  }, { passive: false });

  canvasWrapEl.addEventListener('touchmove', (e) => {
    if (croppingRect && croppingRect._isCropping) return;
    if (e.touches.length !== 2 || !pinchTarget || pinchStartDist === 0) return;

    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const currentDist = touchDist(t1, t2);
    const mid = touchMid(t1, t2);
    pinchMidX = mid.x;
    pinchMidY = mid.y;

    const ratio = currentDist / pinchStartDist;
    const minScale = 0.05;
    const maxScale = 20;

    const newScaleX = Math.min(maxScale, Math.max(minScale, pinchStartScaleX * ratio));
    const newScaleY = Math.min(maxScale, Math.max(minScale, pinchStartScaleY * ratio));

    pinchTarget.set({ scaleX: newScaleX, scaleY: newScaleY });
    pinchTarget.setCoords();
    canvas.requestRenderAll();

    const pct = Math.round(newScaleX * 100);
    showHud(`${pct}%`, mid.x, mid.y);
  }, { passive: false });

  canvasWrapEl.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      if (pinchTarget) {
        pinchTarget.setCoords();
        canvas.requestRenderAll();
        hideHud();
        pinchTarget = null;
        pinchStartDist = 0;
      }
    }
  }, { passive: true });

  canvasWrapEl.addEventListener('touchcancel', () => {
    pinchTarget = null;
    pinchStartDist = 0;
    hideHud();
  }, { passive: true });


  // ---------- CTRL + RUEDA DEL RATÓN (trackpad pinch en escritorio) ----------
  // Los navegadores reportan el gesto de pellizco en trackpad como evento
  // wheel con ctrlKey=true y deltaY negativo/positivo.

  const WHEEL_SCALE_SENSITIVITY = 0.005; // cuánto escalar por unidad de deltaY

  canvasWrapEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; // solo cuando Ctrl está presionado (o gesto trackpad)
    e.preventDefault();

    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (croppingRect && croppingRect._isCropping) return;

    const currentScaleX = obj.scaleX || 1;
    const currentScaleY = obj.scaleY || 1;

    // deltaY positivo = aléjar (reducir escala), negativo = acercar (ampliar)
    const factor = 1 - e.deltaY * WHEEL_SCALE_SENSITIVITY;
    const minScale = 0.05;
    const maxScale = 20;

    const newScaleX = Math.min(maxScale, Math.max(minScale, currentScaleX * factor));
    const newScaleY = Math.min(maxScale, Math.max(minScale, currentScaleY * factor));

    obj.set({ scaleX: newScaleX, scaleY: newScaleY });
    obj.setCoords();
    canvas.requestRenderAll();

    // Posición del HUD: cerca del cursor
    const pct = Math.round(newScaleX * 100);
    showHud(`${pct}%`, e.clientX, e.clientY);
    hideHud();
  }, { passive: false });

})(); // fin initPinchToScale