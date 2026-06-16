import React from 'react'
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';

import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx'

import './css/styles.css';

// Customizable graphic-HUD (OSD) layout editor (#173). A black 16:9 canvas where
// the user drags telemetry elements into place — each chip shows mock data exactly
// as it will be burned onto the video (WYSIWYG), graphic elements (horizon /
// compass / home arrow) render as live mini-previews, and the font / size / colour
// of every text field is editable, globally and per-element.
class HudEditorPage extends basePage {
  constructor(props) {
    super(props, false); // no socket — layout is fetched/saved over REST
    this.state = {
      ...this.state,
      catalog: [],   // [{ type, section, label, mock, graphic }]
      elements: [],  // [{ type, enabled, x, y, icon, font?, size?, color? }]
      global: { font: 'monospace', size: 34, color: '#ffffff' },
      // { generics:[...], fonts:[{family,label,file,kind,id?}] } — generics +
      // curated + imported; each non-generic font is @font-face'd for an exact preview
      fontList: { generics: ['monospace', 'sans-serif', 'serif'], fonts: [] },
      importing: false,
      cameras: [],          // [{ value, label, caps:[{width,height,format}] }]
      selectedCamera: '',   // device value of the camera shown behind the HUD
      showCamera: false,    // toggle the live camera backdrop
      cameraError: false,   // the preview <img> failed to load (busy / no signal)
      // artificial-horizon options (INAV-inspired): AHI styles + aircraft markers
      horizonOpts: { styles: ['ladder', 'line', 'ticks'], markers: ['wings', 'crosshair', 'dot', 'caret', 'drone'] },
      selectedType: null, // element whose style is being edited
      dragType: null,
      message: null,
      error: null
    }
    this.canvasRef = React.createRef();
  }

  componentDidMount() {
    const headers = { Authorization: `Bearer ${this.state.token}` };
    Promise.all([
      fetch('/api/hudlayout', { headers }).then(r => r.json()),
      fetch('/api/hudfonts', { headers }).then(r => r.json()),
      // the camera list (for the "feed behind the HUD" backdrop); tolerate failure
      fetch('/api/videodevices', { headers }).then(r => r.json()).catch(() => ({}))
    ]).then(([data, fontList, vid]) => {
      const layout = data.layout || {};
      const cameras = (vid && vid.devices) || [];
      this.setState({
        catalog: data.elements || [],
        elements: layout.elements || [],
        global: layout.global || this.state.global,
        fontList: (fontList && fontList.generics) ? fontList : this.state.fontList,
        cameras,
        selectedCamera: cameras.length > 0 ? cameras[0].value : '',
        horizonOpts: (data.horizon && data.horizon.styles) ? data.horizon : this.state.horizonOpts
      });
      this.loadDone();
    });
  }

  // MJPEG preview URL for the selected camera (token in the query so the <img>
  // can authenticate); picks a non-compressed cap so it can be JPEG-previewed
  previewSrc() {
    const dev = this.state.cameras.find(c => c.value === this.state.selectedCamera);
    if (!dev) {
      return '';
    }
    const caps = dev.caps || [];
    const cap = caps.find(c => c.format !== 'video/x-h264' && c.format !== 'video/x-h265') || caps[0] || {};
    const q = new URLSearchParams({
      device: dev.value,
      width: cap.width || 1280,
      height: cap.height || 720,
      format: cap.format || 'video/x-raw',
      rotation: 0,
      token: this.state.token || ''
    });
    return '/api/camera/preview?' + q.toString();
  }

  toggleCamera = () => this.setState({ showCamera: !this.state.showCamera, cameraError: false })
  selectCamera = (value) => this.setState({ selectedCamera: value, cameraError: false })

  // the editor's font <select> options: generics + curated + imported
  fontOptions() {
    const g = this.state.fontList.generics || [];
    const f = this.state.fontList.fonts || [];
    return [...g.map(x => ({ value: x, label: x })), ...f.map(x => ({ value: x.family, label: x.label }))];
  }

  // @font-face rules so the browser renders curated/imported fonts exactly as the
  // device will burn them in (the file is served by GET /api/hudfonts/file/:name)
  fontFaceCss() {
    return (this.state.fontList.fonts || [])
      .map(f => `@font-face{font-family:'${f.family}';src:url('/api/hudfonts/file/${f.file}');font-display:swap;}`)
      .join('');
  }

  // upload a .ttf/.otf — installed on the device + added to the list
  importFont = (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // allow re-importing the same filename later
    if (!file) {
      return;
    }
    this.setState({ importing: true, error: null });
    const fd = new FormData();
    fd.append('font', file);
    fetch('/api/hudfonts', { method: 'POST', headers: { Authorization: `Bearer ${this.state.token}` }, body: fd })
      .then(r => r.json()).then(data => {
        if (data.error) {
          this.setState({ importing: false, error: data.error });
          return;
        }
        this.setState({ fontList: data.fonts, importing: false, message: 'Imported font: ' + data.font.family });
        setTimeout(() => this.setState({ message: null }), 4000);
      }).catch(() => this.setState({ importing: false, error: 'Could not import font' }));
  }

  removeFont = (id) => {
    fetch('/api/hudfonts/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(r => r.json()).then(data => {
        if (data.fonts) {
          this.setState({ fontList: data.fonts });
        }
      }).catch(() => this.setState({ error: 'Could not remove font' }));
  }

  getEl(type) {
    return this.state.elements.find(e => e.type === type);
  }

  catalogFor(type) {
    return this.state.catalog.find(e => e.type === type) || { label: type, mock: type, graphic: false };
  }

  isGraphicEl(type) {
    return this.catalogFor(type).graphic;
  }

  // the font/size/colour actually used to draw an element: its own overrides,
  // falling back to the global style
  effStyle(el) {
    const g = this.state.global;
    return {
      font: el.font || g.font,
      size: el.size || g.size,
      color: el.color || g.color
    };
  }

  updateEl(type, patch) {
    this.setState({ elements: this.state.elements.map(e => e.type === type ? { ...e, ...patch } : e) });
  }

  // set or (when value is empty) clear one per-element style override
  setElStyle(type, key, value) {
    this.setState({
      elements: this.state.elements.map(e => {
        if (e.type !== type) {
          return e;
        }
        const next = { ...e };
        if (value === undefined || value === '' || value === null || (typeof value === 'number' && isNaN(value))) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      })
    });
  }

  clearElStyle = (type) => {
    this.setState({
      elements: this.state.elements.map(e => {
        if (e.type !== type) {
          return e;
        }
        const { font, size, color, ...rest } = e; // drop every override
        return rest;
      })
    });
  }

  // set a graphic element's size multiplier (clamped 0.5–5×)
  setElScale(type, value) {
    const v = isNaN(value) ? 1 : Math.min(5, Math.max(0.5, value));
    this.updateEl(type, { scale: v });
  }

  // set a text element's icon size multiplier (clamped 0.5–3×)
  setElIconScale(type, value) {
    const v = isNaN(value) ? 1 : Math.min(3, Math.max(0.5, value));
    this.updateEl(type, { iconScale: v });
  }

  setGlobal(patch) {
    this.setState({ global: { ...this.state.global, ...patch } });
  }

  toggleEnabled = (type) => this.updateEl(type, { enabled: !this.getEl(type).enabled })
  toggleIcon = (type) => this.updateEl(type, { icon: !this.getEl(type).icon })

  startDrag = (type) => (e) => {
    e.preventDefault();
    this.setState({ dragType: type, selectedType: type });
  }

  // map a pointer position to a 0..1 fraction of the canvas and move the dragged element
  handleMove = (e) => {
    if (!this.state.dragType || !this.canvasRef.current) {
      return;
    }
    const rect = this.canvasRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    this.updateEl(this.state.dragType, { x, y });
  }

  endDrag = () => {
    if (this.state.dragType) {
      this.setState({ dragType: null });
    }
  }

  save = () => {
    fetch('/api/hudlayout', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({ layout: { global: this.state.global, elements: this.state.elements } })
    }).then(r => r.json()).then(data => {
      const layout = data.layout || {};
      this.setState({
        elements: layout.elements || this.state.elements,
        global: layout.global || this.state.global,
        message: 'Layout saved.', error: data.error
      });
      setTimeout(() => this.setState({ message: null }), 4000);
    }).catch(() => this.setState({ error: 'Could not save layout' }));
  }

  resetDefault = () => {
    // an empty layout is normalized back to the defaults by the server
    fetch('/api/hudlayout', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({ layout: { elements: [] } })
    }).then(r => r.json()).then(data => {
      const layout = data.layout || {};
      this.setState({
        elements: layout.elements || this.state.elements,
        global: layout.global || this.state.global,
        selectedType: null,
        message: 'Reset to defaults.'
      });
      setTimeout(() => this.setState({ message: null }), 4000);
    }).catch(() => this.setState({ error: 'Could not reset layout' }));
  }

  renderTitle() {
    return 'HUD Editor';
  }

  // the centre aircraft/crosshair marker mini-preview (matches video-server.py)
  renderMarkerMini(marker, mc) {
    if (marker === 'crosshair') {
      return <g stroke={mc} strokeWidth="2" fill="none"><line x1="28" y1="25" x2="37" y2="25" /><line x1="53" y1="25" x2="62" y2="25" /><line x1="45" y1="8" x2="45" y2="17" /><line x1="45" y1="33" x2="45" y2="42" /></g>;
    }
    if (marker === 'dot') {
      return <g><circle cx="45" cy="25" r="3" fill={mc} /><circle cx="45" cy="25" r="6.5" stroke={mc} strokeWidth="1.5" fill="none" /></g>;
    }
    if (marker === 'caret') {
      return <path d="M36 20 L45 29 L54 20" fill="none" stroke={mc} strokeWidth="2.5" />;
    }
    if (marker === 'drone') {
      return <g stroke={mc} strokeWidth="1.5" fill="none"><line x1="34" y1="14" x2="56" y2="36" /><line x1="34" y1="36" x2="56" y2="14" /><circle cx="34" cy="14" r="3" /><circle cx="56" cy="14" r="3" /><circle cx="34" cy="36" r="3" /><circle cx="56" cy="36" r="3" /></g>;
    }
    return <path d="M45 25 l -16 0 l 5 6 M45 25 l 16 0 l -5 6" stroke={mc} strokeWidth="2.5" fill="none" />;
  }

  // a live mini-preview for the shape-only (graphic) elements, reflecting the
  // element's scale, style, marker and colours so the canvas stays WYSIWYG.
  renderGraphic(e) {
    const scale = e.scale || 1;
    if (e.type === 'horizon') {
      const color = e.color || '#00e0a0';
      const style = e.style || 'ladder';
      const ladder = [];
      if (style === 'ladder') {
        ladder.push(<line key="r1" x1="20" y1="15" x2="70" y2="15" stroke={color} strokeWidth="1.5" />);
        ladder.push(<line key="r2" x1="20" y1="35" x2="70" y2="35" stroke={color} strokeWidth="1.5" />);
      } else if (style === 'ticks') {
        [[30, 13], [60, 13], [30, 31], [60, 31]].forEach(([tx, ty], i) => ladder.push(<line key={'t' + i} x1={tx} y1={ty} x2={tx} y2={ty + 6} stroke={color} strokeWidth="1.5" />));
      }
      return (
        <svg width={90 * scale} height={50 * scale} viewBox="0 0 90 50" style={{ display: 'block' }}>
          <g transform="rotate(-14 45 25)">
            <line x1="-30" y1="25" x2="120" y2="25" stroke={color} strokeWidth="2.5" />
            {ladder}
          </g>
          {this.renderMarkerMini(e.marker || 'wings', e.markerColor || '#ffcf40')}
        </svg>
      );
    }
    if (e.type === 'compass') {
      const color = e.color || '#00e0a0';
      return (
        <svg width={120 * scale} height={26 * scale} viewBox="0 0 120 26" style={{ display: 'block' }}>
          {[['N', 20], ['30', 50], ['E', 80], ['60', 110]].map(([lbl, hx]) => (
            <g key={hx}>
              <line x1={hx} y1="12" x2={hx} y2="20" stroke={color} strokeWidth="1.5" />
              <text x={hx} y="9" fill={color} fontSize="9" fontFamily="monospace" textAnchor="middle">{lbl}</text>
            </g>
          ))}
          <path d="M60 26 l -6 -9 l 12 0 Z" fill="#ffcf40" />
        </svg>
      );
    }
    // homeDir — rotating arrow
    const arrowColor = e.color || '#ffcf40';
    return (
      <svg width={34 * scale} height={34 * scale} viewBox="0 0 34 34" className="hud-home-arrow" style={{ display: 'block' }}>
        <circle cx="17" cy="17" r="15" stroke="#00e0a0" strokeWidth="1.5" fill="none" opacity="0.5" />
        <path d="M17 4 L9 28 L17 22 L25 28 Z" fill={arrowColor} />
      </svg>
    );
  }

  // the small (~30-unit) telemetry glyph drawn just left of a text element's value,
  // ported from _hud_icon() in video-server.py so the editor preview matches the
  // burned-in HUD. Always cyan on the video (independent of the text colour); several
  // element types share one concept (battery, gauge, satellite-fix, …) → one glyph.
  renderIcon(type, color = '#7fe9c8', scale = 1) {
    const c = color;
    const wrap = (shape) => (
      <svg className="hud-icon" viewBox="0 0 38 34"
        style={{ height: (1.05 * scale) + 'em', width: 'auto', verticalAlign: 'middle', marginRight: '0.22em', overflow: 'visible' }}>
        {shape}
      </svg>
    );
    if (['batV', 'batPct', 'current', 'mah', 'battTemp', 'battTimeRemaining'].includes(type)) {
      return wrap(<g stroke={c} strokeWidth="3" fill="none"><rect x="3" y="14" width="26" height="16" rx="2" /><rect x="29" y="18" width="3" height="8" fill={c} /></g>);
    }
    if (['alt', 'altRel', 'rangefinder'].includes(type)) {
      return wrap(<path d="M3 24 l12 -22 l12 22 Z" fill={c} />);
    }
    if (['climb', 'gload', 'turnRate'].includes(type)) {
      return wrap(<path d="M3 22 l12 -20 l12 20" stroke={c} strokeWidth="3" fill="none" />);
    }
    if (['spd', 'airspeed', 'throttle', 'cpuLoad', 'dropRate'].includes(type)) {
      return wrap(<path d="M3 22 a14 14 0 0 1 28 0" stroke={c} strokeWidth="3" fill="none" />);
    }
    if (['rcRssi', 'radioRssi', 'radioRemRssi', 'radioNoise'].includes(type)) {
      return wrap(<g stroke={c} strokeWidth="2" fill="none"><line x1="12" y1="6" x2="12" y2="22" /><path d="M5 22 a10 10 0 0 1 14 0" /></g>);
    }
    if (['windSpeed', 'windDir', 'baroTemp', 'pressure', 'vibe', 'vibeClip'].includes(type)) {
      return wrap(<path d="M3 18 q8 -10 16 0 t 16 0" stroke={c} strokeWidth="2" fill="none" />);
    }
    if (['homeDist', 'wpDist', 'xtrack', 'altError'].includes(type)) {
      return wrap(<path d="M3 20 l9 -12 l9 12 v10 h-18 Z" stroke={c} strokeWidth="2" fill="none" />);
    }
    if (['hdg', 'gpsCourse'].includes(type)) {
      return wrap(<g stroke={c} strokeWidth="2" fill="none"><circle cx="16" cy="18" r="13" /><path d="M16 8 l4 8 l-8 0 Z" fill={c} stroke="none" /></g>);
    }
    if (['mode', 'timer', 'clock', 'wpNum'].includes(type)) {
      return wrap(<circle cx="16" cy="18" r="12" stroke={c} strokeWidth="3" fill="none" />);
    }
    if (['gps', 'hdop', 'lat', 'lon', 'modemFix', 'modemLat', 'modemLon', 'modemAlt'].includes(type)) {
      return wrap(<g stroke={c} strokeWidth="2" fill="none"><circle cx="16" cy="18" r="4" fill={c} /><path d="M8 18 a10 10 0 0 1 16 0" /></g>);
    }
    if (type === 'armed') {
      return wrap(<path d="M3 8 l13 -6 l13 6 v10 l-13 8 l-13 -8 Z" stroke={c} strokeWidth="2" fill="none" />);
    }
    return wrap(<circle cx="13" cy="18" r="3" fill={c} />);
  }

  renderChip(e) {
    const graphic = this.isGraphicEl(e.type);
    const selected = this.state.selectedType === e.type;
    const eff = this.effStyle(e);
    const baseStyle = {
      position: 'absolute', left: (e.x * 100) + '%', top: (e.y * 100) + '%',
      transform: 'translate(-50%, -50%)', cursor: 'move', whiteSpace: 'nowrap',
      padding: '1px 5px', borderRadius: 3,
      background: this.state.dragType === e.type ? 'rgba(255,207,64,0.25)' : 'rgba(0,0,0,0.35)',
      outline: selected ? '2px solid #4fa3ff' : 'none', outlineOffset: 1
    };
    if (graphic) {
      return (
        <div key={e.type} onMouseDown={this.startDrag(e.type)} data-eltype={e.type}
          style={{ ...baseStyle, border: '1px solid ' + (selected ? '#4fa3ff' : 'rgba(0,224,160,0.5)') }}>
          {this.renderGraphic(e)}
        </div>
      );
    }
    return (
      <div key={e.type} onMouseDown={this.startDrag(e.type)} data-eltype={e.type}
        style={{
          ...baseStyle, color: eff.color,
          fontFamily: eff.font,
          // size is in 1600-wide HUD units; 100cqw == canvas width, so this scales
          // the chip exactly as rsvgoverlay will scale it onto the frame
          fontSize: 'calc(' + eff.size + ' / 1600 * 100cqw)',
          border: '1px solid ' + (selected ? '#4fa3ff' : 'rgba(255,255,255,0.35)')
        }}>
        {e.icon && this.renderIcon(e.type, e.iconColor || '#7fe9c8', e.iconScale || 1)}{this.catalogFor(e.type).mock}
      </div>
    );
  }

  renderStylePanel() {
    const type = this.state.selectedType;
    if (!type) {
      return <p className="text-muted"><small>Click an element on the screen to edit its font, size and colour.</small></p>;
    }
    const cat = this.catalogFor(type);
    if (cat.graphic) {
      const el = this.getEl(type) || {};
      const gscale = el.scale || 1;
      const isHorizon = type === 'horizon';
      const defColor = type === 'homeDir' ? '#ffcf40' : '#00e0a0';
      return (
        <div style={{ border: '1px solid #2a3340', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}><b>{cat.label}</b> <span className="text-muted"><small>(graphic element — drag to position)</small></span></div>
          <Form className="d-flex flex-wrap align-items-end" style={{ gap: 14 }}>
            <Form.Group>
              <Form.Label className="mb-0"><small>Size<HelpTip text="Scale this graphic, 0.5–5×. Applies to the preview and the burned-in HUD." /></small></Form.Label>
              <div className="d-flex align-items-center" style={{ gap: 8 }}>
                <Form.Range min="0.5" max="5" step="0.1" value={gscale} onChange={ev => this.setElScale(type, parseFloat(ev.target.value))} data-testid="el-scale" style={{ width: 150 }} />
                <span style={{ width: 36 }}>{gscale.toFixed(1)}×</span>
              </div>
            </Form.Group>
            <Form.Group>
              <Form.Label className="mb-0"><small>Colour<HelpTip text="Colour of this graphic (the horizon/compass lines, or the home arrow)." /></small></Form.Label>
              <Form.Control size="sm" type="color" style={{ width: 48, padding: 2 }} value={el.color || defColor} onChange={ev => this.updateEl(type, { color: ev.target.value })} data-testid="el-gcolor" />
            </Form.Group>
            {isHorizon &&
              <React.Fragment>
                <Form.Group>
                  <Form.Label className="mb-0"><small>Style<HelpTip text="Artificial-horizon style (INAV-inspired): pitch ladder, line only, or centre ticks." /></small></Form.Label>
                  <Form.Select size="sm" value={el.style || 'ladder'} onChange={ev => this.updateEl(type, { style: ev.target.value })} data-testid="el-hstyle">
                    {this.state.horizonOpts.styles.map(s => <option key={s} value={s}>{s}</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group>
                  <Form.Label className="mb-0"><small>Aircraft<HelpTip text="The centre aircraft / crosshair symbol (INAV crosshair styles)." /></small></Form.Label>
                  <Form.Select size="sm" value={el.marker || 'wings'} onChange={ev => this.updateEl(type, { marker: ev.target.value })} data-testid="el-marker">
                    {this.state.horizonOpts.markers.map(s => <option key={s} value={s}>{s}</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group>
                  <Form.Label className="mb-0"><small>Aircraft colour<HelpTip text="Colour of the centre aircraft symbol (was fixed yellow)." /></small></Form.Label>
                  <Form.Control size="sm" type="color" style={{ width: 48, padding: 2 }} value={el.markerColor || '#ffcf40'} onChange={ev => this.updateEl(type, { markerColor: ev.target.value })} data-testid="el-mcolor" />
                </Form.Group>
              </React.Fragment>}
          </Form>
        </div>
      );
    }
    const el = this.getEl(type) || {};
    const g = this.state.global;
    const hasColor = el.color !== undefined;
    return (
      <div style={{ border: '1px solid #2a3340', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}><b>{cat.label}</b> style <span className="text-muted"><small>(blank = use global)</small></span></div>
        <Form className="d-flex flex-wrap align-items-end" style={{ gap: 12 }}>
          <Form.Group>
            <Form.Label className="mb-0"><small>Font<HelpTip text="Font family for this field. Blank uses the global font." /></small></Form.Label>
            <Form.Select size="sm" value={el.font || ''} onChange={ev => this.setElStyle(type, 'font', ev.target.value)} data-testid="el-font">
              <option value="">Global ({g.font})</option>
              {this.fontOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="mb-0"><small>Size<HelpTip text="Text height in HUD units (10–120). Blank uses the global size." /></small></Form.Label>
            <Form.Control size="sm" type="number" min="10" max="120" style={{ width: 90 }} placeholder={String(g.size)}
              value={el.size === undefined ? '' : el.size}
              onChange={ev => this.setElStyle(type, 'size', ev.target.value === '' ? undefined : parseInt(ev.target.value, 10))} data-testid="el-size" />
          </Form.Group>
          <Form.Group>
            <Form.Label className="mb-0"><small>Colour<HelpTip text="Tick to give this field its own colour; unticked it uses the global colour." /></small></Form.Label>
            <div className="d-flex align-items-center" style={{ gap: 6 }}>
              <Form.Check type="checkbox" checked={hasColor} onChange={ev => this.setElStyle(type, 'color', ev.target.checked ? (el.color || g.color) : undefined)} data-testid="el-color-on" />
              <Form.Control size="sm" type="color" style={{ width: 48, padding: 2 }} disabled={!hasColor}
                value={el.color || g.color} onChange={ev => this.setElStyle(type, 'color', ev.target.value)} data-testid="el-color" />
            </div>
          </Form.Group>
          {el.icon &&
            <React.Fragment>
              <Form.Group>
                <Form.Label className="mb-0"><small>Icon size<HelpTip text="Size of this field's icon, 0.5–3× the text height. Applies to the preview and the burned-in HUD." /></small></Form.Label>
                <div className="d-flex align-items-center" style={{ gap: 8 }}>
                  <Form.Range min="0.5" max="3" step="0.1" value={el.iconScale || 1} onChange={ev => this.setElIconScale(type, parseFloat(ev.target.value))} data-testid="el-iconscale" style={{ width: 110 }} />
                  <span style={{ width: 30 }}>{(el.iconScale || 1).toFixed(1)}×</span>
                </div>
              </Form.Group>
              <Form.Group>
                <Form.Label className="mb-0"><small>Icon colour<HelpTip text="Colour of this field's icon. Defaults to cyan; tick to give it your own colour." /></small></Form.Label>
                <div className="d-flex align-items-center" style={{ gap: 6 }}>
                  <Form.Check type="checkbox" checked={el.iconColor !== undefined} onChange={ev => this.setElStyle(type, 'iconColor', ev.target.checked ? (el.iconColor || '#7fe9c8') : undefined)} data-testid="el-iconcolor-on" />
                  <Form.Control size="sm" type="color" style={{ width: 48, padding: 2 }} disabled={el.iconColor === undefined}
                    value={el.iconColor || '#7fe9c8'} onChange={ev => this.setElStyle(type, 'iconColor', ev.target.value)} data-testid="el-iconcolor" />
                </div>
              </Form.Group>
            </React.Fragment>}
          <Button size="sm" variant="outline-secondary" onClick={() => this.clearElStyle(type)}>Use global</Button>
        </Form>
      </div>
    );
  }

  // one palette row (a telemetry element with Show / Icon toggles)
  renderPaletteRow(c) {
    const e = this.getEl(c.type) || { enabled: false, icon: false };
    return (
      <tr key={c.type} className={this.state.selectedType === c.type ? 'table-active' : ''} onClick={() => this.setState({ selectedType: c.type })} style={{ cursor: 'pointer' }}>
        <td>{c.label}</td>
        <td><span style={{ fontFamily: 'monospace', color: '#9fe6cf' }}>{c.graphic ? '⊕ shape' : c.mock}</span></td>
        <td><Form.Check type="checkbox" checked={e.enabled} onChange={() => this.toggleEnabled(c.type)} onClick={ev => ev.stopPropagation()} /></td>
        <td>{c.graphic ? <span>—</span> : <Form.Check type="checkbox" checked={e.icon} onChange={() => this.toggleIcon(c.type)} onClick={ev => ev.stopPropagation()} />}</td>
      </tr>
    );
  }

  // the element palette, grouped by section and split into two balanced columns
  renderPalette() {
    const groups = [];
    this.state.catalog.forEach(c => {
      let g = groups[groups.length - 1];
      if (!g || g.section !== c.section) {
        g = { section: c.section, items: [] };
        groups.push(g);
      }
      g.items.push(c);
    });
    const colA = [];
    const colB = [];
    let count = 0;
    const half = this.state.catalog.length / 2;
    groups.forEach(g => {
      (count < half ? colA : colB).push(g);
      count += g.items.length;
    });
    const head = <thead><tr><th>Element</th><th>Preview</th><th>Show<HelpTip text="Include this stat in the HUD." /></th><th>Icon<HelpTip text="Draw the element's icon next to its value." /></th></tr></thead>;
    const renderCol = (cols) => (
      <Table striped bordered hover size="sm" className="mb-0">
        {head}
        <tbody>
          {cols.map(g => (
            <React.Fragment key={g.section}>
              <tr className="table-secondary"><td colSpan="4"><b>{g.section}</b></td></tr>
              {g.items.map(c => this.renderPaletteRow(c))}
            </React.Fragment>
          ))}
        </tbody>
      </Table>
    );
    return (
      <div className="row g-2">
        <div className="col-12 col-md-6">{renderCol(colA)}</div>
        <div className="col-12 col-md-6">{renderCol(colB)}</div>
      </div>
    );
  }

  renderContent() {
    const importedFonts = (this.state.fontList.fonts || []).filter(f => f.kind === 'imported');
    return (
      <div style={{ maxWidth: 920 }}>
        <p><i>Arrange the graphic HUD: drag elements on the screen, pick which stats and icons to show, and style the text — each chip shows the value exactly as it will appear on the video.</i></p>
        <HelpSection title="About the HUD editor">
          <p>This configures the <b>Graphic</b> Telemetry HUD (enable it on the Photo &amp; Video page, HUD Style = Graphic). The black area below represents your video frame, drawn with <b>mock data</b> so you see real-looking values. Drag an element to position it; tick <b>Show</b> to include a stat and <b>Icon</b> to draw its icon. Click an element to change its <b>font, size and colour</b> — or set those globally below. For a field with its icon shown, you can also size and colour the <b>icon</b> independently (it defaults to cyan). Press <b>Save</b> to apply — a running graphic stream updates live.</p>
          <p>The <i>Artificial Horizon</i>, <i>Compass</i> and <i>Home arrow</i> are graphic elements (the home arrow rotates to point home like a compass). The <i>Modem GPS</i> elements show the SIM7600&apos;s own GNSS fix, available even with no flight controller connected.</p>
        </HelpSection>

        <div className="d-flex flex-wrap align-items-end mb-2" style={{ gap: 14, border: '1px solid #2a3340', borderRadius: 4, padding: '8px 12px' }}>
          <div><b>Global text style</b></div>
          <Form.Group>
            <Form.Label className="mb-0"><small>Font<HelpTip text="Default font family for every text field, unless a field overrides it." /></small></Form.Label>
            <Form.Select size="sm" value={this.state.global.font} onChange={ev => this.setGlobal({ font: ev.target.value })} data-testid="global-font">
              {this.fontOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="mb-0"><small>Size<HelpTip text="Default text height in HUD units (10–120). The frame is 1600 units wide." /></small></Form.Label>
            <Form.Control size="sm" type="number" min="10" max="120" style={{ width: 90 }} value={this.state.global.size}
              onChange={ev => this.setGlobal({ size: ev.target.value === '' ? '' : parseInt(ev.target.value, 10) })} data-testid="global-size" />
          </Form.Group>
          <Form.Group>
            <Form.Label className="mb-0"><small>Colour<HelpTip text="Default text colour for every field, unless a field overrides it." /></small></Form.Label>
            <Form.Control size="sm" type="color" style={{ width: 48, padding: 2 }} value={this.state.global.color}
              onChange={ev => this.setGlobal({ color: ev.target.value })} data-testid="global-color" />
          </Form.Group>
          <div className="d-flex align-items-center" style={{ gap: 8, marginLeft: 'auto' }}>
            <label className="btn btn-sm btn-outline-secondary mb-0" style={{ cursor: 'pointer' }}>
              {this.state.importing ? 'Importing…' : 'Import font…'}
              <HelpTip text="Upload a .ttf/.otf to add it to the list. It is installed on the device and rendered both here and on the video, so the preview matches." />
              <input type="file" accept=".ttf,.otf" style={{ display: 'none' }} onChange={this.importFont} disabled={this.state.importing} data-testid="font-import" />
            </label>
          </div>
        </div>

        <div className="d-flex flex-wrap align-items-center mb-2" style={{ gap: 12, border: '1px solid #2a3340', borderRadius: 4, padding: '8px 12px' }}>
          <Form.Check type="switch" id="hud-show-camera" label="Show camera feed behind the HUD" checked={this.state.showCamera} onChange={this.toggleCamera} disabled={this.state.cameras.length === 0} data-testid="show-camera" />
          <HelpTip text="Live MJPEG preview of a camera as the editor backdrop, so you can position the HUD over the real picture. Only works when that camera isn't already streaming." />
          <Form.Select size="sm" style={{ width: 'auto', maxWidth: 340 }} value={this.state.selectedCamera} onChange={ev => this.selectCamera(ev.target.value)} disabled={!this.state.showCamera || this.state.cameras.length === 0} data-testid="camera-select">
            {this.state.cameras.length === 0
              ? <option value="">No cameras found</option>
              : this.state.cameras.map(c => <option key={c.value} value={c.value}>{c.label || c.value}</option>)}
          </Form.Select>
          {this.state.cameraError && <span className="text-warning"><small>Camera unavailable (busy, or no signal)</small></span>}
        </div>

        {importedFonts.length > 0 &&
          <div className="mb-2"><small className="text-muted">Imported fonts: </small>
            {importedFonts.map(f => (
              <span key={f.id} className="badge bg-secondary" style={{ marginRight: 6, fontWeight: 'normal' }}>
                {f.family}{' '}
                <span role="button" aria-label={'Remove ' + f.family} style={{ cursor: 'pointer' }} onClick={() => this.removeFont(f.id)} data-testid={'font-remove-' + f.id}>×</span>
              </span>
            ))}
          </div>}

        {/* @font-face so curated/imported fonts preview exactly as the device renders them */}
        <style dangerouslySetInnerHTML={{ __html: this.fontFaceCss() }} />

        <div
          ref={this.canvasRef}
          onMouseMove={this.handleMove}
          onMouseUp={this.endDrag}
          onMouseLeave={this.endDrag}
          style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#0a0d12', border: '1px solid #2a3340', borderRadius: 4, overflow: 'hidden', userSelect: 'none', marginBottom: 12, containerType: 'inline-size' }}
        >
          {this.state.showCamera && this.state.selectedCamera &&
            <img key={this.previewSrc()} src={this.previewSrc()} alt="" onError={() => this.setState({ cameraError: true })}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} data-testid="camera-feed" />}
          {this.state.elements.filter(e => e.enabled).map(e => this.renderChip(e))}
        </div>

        {this.renderStylePanel()}

        {this.state.message && <div className="alert alert-success" role="alert">{this.state.message}</div>}
        {this.state.error && <div className="alert alert-warning" role="alert">{this.state.error}</div>}

        {this.renderPalette()}

        <Button onClick={this.save}>Save Layout</Button>{' '}
        <Button variant="secondary" onClick={this.resetDefault}>Reset to Defaults</Button>
      </div>
    );
  }
}

export default HudEditorPage;
