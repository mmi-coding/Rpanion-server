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
      fonts: ['monospace', 'sans-serif', 'serif'],
      selectedType: null, // element whose style is being edited
      dragType: null,
      message: null,
      error: null
    }
    this.canvasRef = React.createRef();
  }

  componentDidMount() {
    fetch('/api/hudlayout', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(r => r.json()).then(data => {
      const layout = data.layout || {};
      this.setState({
        catalog: data.elements || [],
        elements: layout.elements || [],
        global: layout.global || this.state.global,
        fonts: data.fonts || this.state.fonts
      });
      this.loadDone();
    });
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

  // a live mini-preview for the shape-only (graphic) elements, so the canvas is
  // WYSIWYG. The home arrow slowly rotates to show it tracks home like a compass.
  renderGraphic(type) {
    if (type === 'horizon') {
      return (
        <svg width="90" height="50" viewBox="0 0 90 50" style={{ display: 'block' }}>
          <g transform="rotate(-14 45 25)">
            <line x1="-30" y1="25" x2="120" y2="25" stroke="#00e0a0" strokeWidth="2.5" />
            <line x1="20" y1="15" x2="70" y2="15" stroke="#00e0a0" strokeWidth="1.5" />
            <line x1="20" y1="35" x2="70" y2="35" stroke="#00e0a0" strokeWidth="1.5" />
          </g>
          <path d="M45 25 l -16 0 l 5 6 M45 25 l 16 0 l -5 6" stroke="#ffcf40" strokeWidth="2.5" fill="none" />
        </svg>
      );
    }
    if (type === 'compass') {
      return (
        <svg width="120" height="26" viewBox="0 0 120 26" style={{ display: 'block' }}>
          {[['N', 20], ['30', 50], ['E', 80], ['60', 110]].map(([lbl, hx]) => (
            <g key={hx}>
              <line x1={hx} y1="12" x2={hx} y2="20" stroke="#00e0a0" strokeWidth="1.5" />
              <text x={hx} y="9" fill="#00e0a0" fontSize="9" fontFamily="monospace" textAnchor="middle">{lbl}</text>
            </g>
          ))}
          <path d="M60 26 l -6 -9 l 12 0 Z" fill="#ffcf40" />
        </svg>
      );
    }
    // homeDir — rotating arrow
    return (
      <svg width="34" height="34" viewBox="0 0 34 34" className="hud-home-arrow" style={{ display: 'block' }}>
        <circle cx="17" cy="17" r="15" stroke="#00e0a0" strokeWidth="1.5" fill="none" opacity="0.5" />
        <path d="M17 4 L9 28 L17 22 L25 28 Z" fill="#ffcf40" />
      </svg>
    );
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
          {this.renderGraphic(e.type)}
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
        {(e.icon ? '◈ ' : '') + this.catalogFor(e.type).mock}
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
      return <p className="text-muted"><small>Selected: <b>{cat.label}</b> — graphic elements have no text style. Drag it to reposition.</small></p>;
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
              {this.state.fonts.map(f => <option key={f} value={f}>{f}</option>)}
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
          <Button size="sm" variant="outline-secondary" onClick={() => this.clearElStyle(type)}>Use global</Button>
        </Form>
      </div>
    );
  }

  renderContent() {
    return (
      <div style={{ maxWidth: 760 }}>
        <p><i>Arrange the graphic HUD: drag elements on the screen, pick which stats and icons to show, and style the text — each chip shows the value exactly as it will appear on the video.</i></p>
        <HelpSection title="About the HUD editor">
          <p>This configures the <b>Graphic</b> Telemetry HUD (enable it on the Photo &amp; Video page, HUD Style = Graphic). The black area below represents your video frame, drawn with <b>mock data</b> so you see real-looking values. Drag an element to position it; tick <b>Show</b> to include a stat and <b>Icon</b> to draw its icon. Click an element to change its <b>font, size and colour</b> — or set those globally below. Press <b>Save</b> to apply — a running graphic stream updates live.</p>
          <p>The <i>Artificial Horizon</i>, <i>Compass</i> and <i>Home arrow</i> are graphic elements (the home arrow rotates to point home like a compass). The <i>Modem GPS</i> elements show the SIM7600&apos;s own GNSS fix, available even with no flight controller connected.</p>
        </HelpSection>

        <div className="d-flex flex-wrap align-items-end mb-2" style={{ gap: 14, border: '1px solid #2a3340', borderRadius: 4, padding: '8px 12px' }}>
          <div><b>Global text style</b></div>
          <Form.Group>
            <Form.Label className="mb-0"><small>Font<HelpTip text="Default font family for every text field, unless a field overrides it." /></small></Form.Label>
            <Form.Select size="sm" value={this.state.global.font} onChange={ev => this.setGlobal({ font: ev.target.value })} data-testid="global-font">
              {this.state.fonts.map(f => <option key={f} value={f}>{f}</option>)}
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
        </div>

        <div
          ref={this.canvasRef}
          onMouseMove={this.handleMove}
          onMouseUp={this.endDrag}
          onMouseLeave={this.endDrag}
          style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#0a0d12', border: '1px solid #2a3340', borderRadius: 4, overflow: 'hidden', userSelect: 'none', marginBottom: 12, containerType: 'inline-size' }}
        >
          {this.state.elements.filter(e => e.enabled).map(e => this.renderChip(e))}
        </div>

        {this.renderStylePanel()}

        {this.state.message && <div className="alert alert-success" role="alert">{this.state.message}</div>}
        {this.state.error && <div className="alert alert-warning" role="alert">{this.state.error}</div>}

        <Table striped bordered hover size="sm">
          <thead><tr><th>Element</th><th>Preview</th><th>Show<HelpTip text="Include this stat in the HUD." /></th><th>Icon<HelpTip text="Draw the element's icon next to its value." /></th></tr></thead>
          <tbody>
            {this.state.catalog.map((c, i) => {
              const e = this.getEl(c.type) || { enabled: false, icon: false };
              const newSection = i === 0 || c.section !== this.state.catalog[i - 1].section;
              return (
                <React.Fragment key={c.type}>
                  {newSection && <tr className="table-secondary"><td colSpan="4"><b>{c.section}</b></td></tr>}
                  <tr className={this.state.selectedType === c.type ? 'table-active' : ''} onClick={() => this.setState({ selectedType: c.type })} style={{ cursor: 'pointer' }}>
                    <td>{c.label}</td>
                    <td><span style={{ fontFamily: 'monospace', color: '#9fe6cf' }}>{c.graphic ? '⊕ shape' : c.mock}</span></td>
                    <td><Form.Check type="checkbox" checked={e.enabled} onChange={() => this.toggleEnabled(c.type)} onClick={ev => ev.stopPropagation()} /></td>
                    <td>{c.graphic ? <span>—</span> : <Form.Check type="checkbox" checked={e.icon} onChange={() => this.toggleIcon(c.type)} onClick={ev => ev.stopPropagation()} />}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </Table>

        <Button onClick={this.save}>Save Layout</Button>{' '}
        <Button variant="secondary" onClick={this.resetDefault}>Reset to Defaults</Button>
      </div>
    );
  }
}

export default HudEditorPage;
