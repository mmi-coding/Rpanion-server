import React from 'react'
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';

import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx'

import './css/styles.css';

// Customizable graphic-HUD (OSD) layout editor (#173). A black 16:9 canvas where
// the user drags telemetry elements into place, plus a palette to enable each stat
// and toggle its icon — applied live to the graphic HUD.
class HudEditorPage extends basePage {
  constructor(props) {
    super(props, false); // no socket — layout is fetched/saved over REST
    this.state = {
      ...this.state,
      catalog: [],   // [{ type, label, sample }]
      elements: [],  // [{ type, enabled, x, y, icon }]
      dragType: null,
      message: null,
      error: null
    }
    this.canvasRef = React.createRef();
  }

  componentDidMount() {
    fetch('/api/hudlayout', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(r => r.json()).then(data => {
      this.setState({ catalog: data.elements || [], elements: (data.layout && data.layout.elements) || [] });
      this.loadDone();
    });
  }

  getEl(type) {
    return this.state.elements.find(e => e.type === type);
  }

  sampleFor(type) {
    const c = this.state.catalog.find(e => e.type === type);
    return c ? c.label : type;
  }

  // graphic elements have no value text / icon toggle (drawn as shapes)
  isGraphicEl(type) {
    return type === 'horizon' || type === 'compass' || type === 'homeDir';
  }

  updateEl(type, patch) {
    this.setState({ elements: this.state.elements.map(e => e.type === type ? { ...e, ...patch } : e) });
  }

  toggleEnabled = (type) => this.updateEl(type, { enabled: !this.getEl(type).enabled })
  toggleIcon = (type) => this.updateEl(type, { icon: !this.getEl(type).icon })

  startDrag = (type) => (e) => {
    e.preventDefault();
    this.setState({ dragType: type });
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
      body: JSON.stringify({ layout: { elements: this.state.elements } })
    }).then(r => r.json()).then(data => {
      this.setState({ elements: (data.layout && data.layout.elements) || this.state.elements, message: 'Layout saved.', error: data.error });
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
      this.setState({ elements: (data.layout && data.layout.elements) || this.state.elements, message: 'Reset to defaults.' });
      setTimeout(() => this.setState({ message: null }), 4000);
    }).catch(() => this.setState({ error: 'Could not reset layout' }));
  }

  renderTitle() {
    return 'HUD Editor';
  }

  renderContent() {
    return (
      <div style={{ maxWidth: 720 }}>
        <p><i>Arrange the graphic HUD: drag elements on the screen, and pick which stats and icons to show.</i></p>
        <HelpSection title="About the HUD editor">
          <p>This configures the <b>Graphic</b> Telemetry HUD (enable it on the Photo &amp; Video page, HUD Style = Graphic). The black area below represents your video frame. Drag an element to position it; tick <b>Show</b> to include a stat and <b>Icon</b> to draw its icon. Press <b>Save</b> to apply — a running graphic stream updates live.</p>
          <p>The <i>Artificial Horizon</i> is itself an element: untick it for a text-only OSD, or drag it to recentre.</p>
        </HelpSection>

        <div
          ref={this.canvasRef}
          onMouseMove={this.handleMove}
          onMouseUp={this.endDrag}
          onMouseLeave={this.endDrag}
          style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#0a0d12', border: '1px solid #2a3340', borderRadius: 4, overflow: 'hidden', userSelect: 'none', marginBottom: 12 }}
        >
          {this.state.elements.filter(e => e.enabled).map(e => (
            <div
              key={e.type}
              onMouseDown={this.startDrag(e.type)}
              style={{
                position: 'absolute', left: (e.x * 100) + '%', top: (e.y * 100) + '%',
                transform: 'translate(-50%, -50%)', cursor: 'move', whiteSpace: 'nowrap',
                padding: '2px 6px', borderRadius: 3,
                background: this.state.dragType === e.type ? 'rgba(255,207,64,0.25)' : 'rgba(0,0,0,0.35)',
                color: this.isGraphicEl(e.type) ? '#00e0a0' : '#ffffff',
                border: '1px solid ' + (this.isGraphicEl(e.type) ? '#00e0a0' : 'rgba(255,255,255,0.4)'),
                fontFamily: 'monospace', fontSize: 13
              }}
              data-eltype={e.type}
            >
              {this.isGraphicEl(e.type) ? ('⊕ ' + e.type) : ((e.icon ? '◈ ' : '') + this.sampleFor(e.type))}
            </div>
          ))}
        </div>

        {this.state.message && <div className="alert alert-success" role="alert">{this.state.message}</div>}
        {this.state.error && <div className="alert alert-warning" role="alert">{this.state.error}</div>}

        <Table striped bordered hover size="sm">
          <thead><tr><th>Element</th><th>Show<HelpTip text="Include this stat in the HUD." /></th><th>Icon<HelpTip text="Draw the element's icon next to its value." /></th></tr></thead>
          <tbody>
            {this.state.catalog.map((c, i) => {
              const e = this.getEl(c.type) || { enabled: false, icon: false };
              const newSection = i === 0 || c.section !== this.state.catalog[i - 1].section;
              return (
                <React.Fragment key={c.type}>
                  {newSection && <tr className="table-secondary"><td colSpan="3"><b>{c.section}</b></td></tr>}
                  <tr>
                    <td>{c.label}</td>
                    <td><Form.Check type="checkbox" checked={e.enabled} onChange={() => this.toggleEnabled(c.type)} /></td>
                    <td>{(c.type === 'horizon' || c.type === 'compass' || c.type === 'homeDir') ? <span>—</span> : <Form.Check type="checkbox" checked={e.icon} onChange={() => this.toggleIcon(c.type)} />}</td>
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
