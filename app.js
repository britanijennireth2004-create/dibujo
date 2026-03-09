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

const hToggleControls = $('h-toggle-controls');
const mobileCloseControls = $('mobile-close-controls');
const controlsPanel = $('controls-panel');

const canvasWrapper = $('canvas-wrapper'); // wrapper que controla layout

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

let activeMobileMode = null; // 'crop', 'text', 'adjustment'
let currentAdjustmentType = null;



// Header toggle: mostrar/ocultar panel de controles
hToggleControls.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('show-controls');
  controlsPanel.setAttribute('aria-hidden', !isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
  setTimeout(() => fitZoomToContainer(), 180);
});
mobileCloseControls.addEventListener('click', () => {
  document.body.classList.remove('show-controls');
  controlsPanel.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
});

// Ajustes de resize
// Ajustes de resize con debounce para mejorar rendimiento
const debouncedResize = debounce(() => {
  if (window.innerWidth > 900) {
    document.body.classList.remove('show-controls');
    controlsPanel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = '';
  } else {
    // Si no está el menú abierto, ocultar panel
    if (!document.body.classList.contains('show-controls')) {
      controlsPanel.setAttribute('aria-hidden', 'true');
    }
  }
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
  if (!hasBrightness) imgObj.filters.push(new F.Brightness({ brightness: 0 }));
  if (!hasContrast) imgObj.filters.push(new F.Contrast({ contrast: 0 }));
  if (!hasSaturation) imgObj.filters.push(new F.Saturation({ saturation: 0 }));
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
uploadBase.addEventListener('change', (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  fabric.Image.fromURL(url, function (img) {
    img.set({ left: internalSize.width / 2, top: internalSize.height / 2, originX: 'center', originY: 'center', selectable: true, hasControls: true });
    const maxW = internalSize.width * 0.95, maxH = internalSize.height * 0.95;
    const fitScale = Math.min(maxW / img.width, maxH / img.height);
    // permitir upscale moderado (hasta 2x) para que imágenes pequeñas no queden diminutas
    let scale = (isFinite(fitScale) && fitScale > 0) ? Math.min(fitScale, 2) : 1;
    // si la imagen ya es muy grande y fitScale > 1, ajustar no subiendo demasiado
    img.scale(scale);
    canvas.add(img).setActiveObject(img);
    URL.revokeObjectURL(url);
    canvas.requestRenderAll();
    // Ajustar automáticamente el lienzo al tamaño de la imagen subida
    try {
      fitCanvasToSelectedImage();
    } catch (e) {
      // En caso de fallo, seguimos con el ajuste de zoom habitual
    }
    fitZoomToContainer();
  }, { crossOrigin: 'anonymous' });
  ev.target.value = '';
});

uploadOverlay.addEventListener('change', (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  fabric.Image.fromURL(url, function (img) {
    img.set({ left: internalSize.width / 2 + 40, top: internalSize.height / 2 + 40, originX: 'center', originY: 'center', selectable: true, hasControls: true });
    const maxW = internalSize.width * 0.9, maxH = internalSize.height * 0.9;
    const fitScale = Math.min(maxW / img.width, maxH / img.height);
    let scale = (isFinite(fitScale) && fitScale > 0) ? Math.min(fitScale, 1.5) : 1;
    img.scale(scale);
    canvas.add(img).setActiveObject(img);
    URL.revokeObjectURL(url);
    canvas.requestRenderAll();
    fitZoomToContainer();
  }, { crossOrigin: 'anonymous' });
  ev.target.value = '';
});

// ---------------- Selección y texto ----------------
canvas.on('selection:created', updateSelected);
canvas.on('selection:updated', updateSelected);
canvas.on('selection:cleared', () => { selectedInfo.textContent = 'Ninguno'; imageControls.style.display = 'none'; });

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

// Teclas: delete/backspace - Corregido para no interferir con edición de texto
document.addEventListener('keydown', (e) => {
  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;

  // No borrar si el usuario está editando texto dentro del canvas o en un input real
  if (activeObj.isEditing) return;

  const target = e.target;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    // Si es un grupo seleccionado, borrar todos
    if (activeObj.type === 'activeSelection') {
      activeObj.forEachObject(obj => canvas.remove(obj));
      canvas.discardActiveObject();
    } else {
      canvas.remove(activeObj);
    }
    canvas.requestRenderAll();
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



// Global click to close popups
document.addEventListener('click', (e) => {
  if (window.innerWidth > 900) return;
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
      const obj = canvas.getActiveObject();
      if (!obj || obj.type !== 'image') { alert('Selecciona una imagen primero.'); return; }

      hideAllMobilePanels();
      currentAdjustmentType = type;
      if (mSliderPanel) mSliderPanel.style.display = 'block';
      if (mSliderLabel) mSliderLabel.textContent = btn.textContent;

      ensureFilters(obj);
      const f = obj.filters;
      const b = f.find(f => f && f.type === 'Brightness');
      const c = f.find(f => f && f.type === 'Contrast');
      const s = f.find(f => f && f.type === 'Saturation');

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

    const f = obj.filters;
    const val = parseInt(mDynamicSlider.value);

    if (currentAdjustmentType === 'brightness') {
      const b = f.find(f => f && f.type === 'Brightness');
      if (b) b.brightness = mapFilter(val);
    } else if (currentAdjustmentType === 'contrast') {
      const c = f.find(f => f && f.type === 'Contrast');
      if (c) c.contrast = mapFilter(val);
    } else if (currentAdjustmentType === 'saturation') {
      const s = f.find(f => f && f.type === 'Saturation');
      if (s) s.saturation = val / 100;
    } else if (currentAdjustmentType === 'opacity') {
      obj.opacity = val / 100;
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