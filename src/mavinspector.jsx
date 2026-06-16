import Card from 'react-bootstrap/Card';
import Table from 'react-bootstrap/Table';

import React from 'react'

import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx'

import './css/styles.css';

// Live view of the MAVLink telemetry the flight controller is sending. The
// backend (mavTelemetry.ts) keeps the latest of every message type and pushes a
// snapshot over socket.io each second; this page shows a curated summary plus a
// full, expandable inspector of every message + field.
class MavInspectorPage extends basePage {
  constructor(props, useSocketIO = true) {
    super(props, useSocketIO);
    this.state = {
      ...this.state,
      telem: [],        // array of { name, msgid, rate, count, stale, fields }
      expanded: {},     // message name -> expanded?
      filter: ''
    }

    this.socket.on('MAVTelemetry', function (msg) {
      this.setState({ telem: msg });
    }.bind(this));
    this.socket.on('reconnect', function () {
      this.componentDidMount();
    }.bind(this));
  }

  componentDidMount() {
    // all data arrives over socket.io — nothing to fetch
    this.loadDone();
  }

  toggleExpand = (name) => {
    this.setState(prev => ({ expanded: { ...prev.expanded, [name]: !prev.expanded[name] } }));
  }

  handleFilter = (e) => this.setState({ filter: e.target.value })

  renderTitle() {
    return "MAVLink Inspector";
  }

  // latest value of one field of one message, or null if not seen yet
  field(name, key) {
    const m = this.state.telem.find(t => t.name === name);
    return (m && m.fields[key] !== undefined && m.fields[key] !== null) ? m.fields[key] : null;
  }

  renderContent() {
    const fmt = (v, digits = 2) => (v === null ? '—' : (typeof v === 'number' ? v.toFixed(digits) : String(v)));
    const scale = (v, factor) => (v === null ? null : v * factor);
    const deg = (v) => (v === null ? null : v * 180 / Math.PI);
    const armed = (v) => (v === null ? '—' : ((v & 128) ? 'ARMED' : 'DISARMED'));
    const f = (name, key) => this.field(name, key);

    // curated at-a-glance cards, derived from the raw message snapshot
    const cards = [
      { title: 'Attitude', rows: [
        ['Roll', fmt(deg(f('ATTITUDE', 'roll')), 1) + '°'],
        ['Pitch', fmt(deg(f('ATTITUDE', 'pitch')), 1) + '°'],
        ['Yaw', fmt(deg(f('ATTITUDE', 'yaw')), 1) + '°'],
        ['Heading', fmt(f('VFR_HUD', 'heading'), 0) + '°'],
      ] },
      { title: 'Speed & Altitude', rows: [
        ['Airspeed', fmt(f('VFR_HUD', 'airspeed'), 1) + ' m/s'],
        ['Ground spd', fmt(f('VFR_HUD', 'groundspeed'), 1) + ' m/s'],
        ['Alt (MSL)', fmt(f('VFR_HUD', 'alt'), 1) + ' m'],
        ['Climb', fmt(f('VFR_HUD', 'climb'), 1) + ' m/s'],
        ['Throttle', fmt(f('VFR_HUD', 'throttle'), 0) + ' %'],
      ] },
      { title: 'GPS', rows: [
        ['Fix type', fmt(f('GPS_RAW_INT', 'fixType'), 0)],
        ['Satellites', fmt(f('GPS_RAW_INT', 'satellitesVisible'), 0)],
        ['Latitude', fmt(scale(f('GLOBAL_POSITION_INT', 'lat'), 1e-7), 7)],
        ['Longitude', fmt(scale(f('GLOBAL_POSITION_INT', 'lon'), 1e-7), 7)],
        ['Alt (rel)', fmt(scale(f('GLOBAL_POSITION_INT', 'relativeAlt'), 1e-3), 1) + ' m'],
      ] },
      { title: 'Battery', rows: [
        ['Voltage', fmt(scale(f('SYS_STATUS', 'voltageBattery'), 1e-3), 2) + ' V'],
        ['Current', fmt(scale(f('SYS_STATUS', 'currentBattery'), 1e-2), 2) + ' A'],
        ['Remaining', fmt(f('SYS_STATUS', 'batteryRemaining'), 0) + ' %'],
      ] },
      { title: 'Status', rows: [
        ['Armed', armed(f('HEARTBEAT', 'baseMode'))],
        ['Custom mode', fmt(f('HEARTBEAT', 'customMode'), 0)],
        ['RC RSSI', fmt(f('RC_CHANNELS', 'rssi'), 0)],
      ] },
    ];

    const filter = this.state.filter.trim().toUpperCase();
    const rows = filter ? this.state.telem.filter(m => m.name.includes(filter)) : this.state.telem;

    return (
      <div style={{ maxWidth: 900 }}>
        <p><i>Live MAVLink telemetry from the flight controller — a quick summary plus every message and field.</i></p>
        <HelpSection title="What this shows">
          <p>The flight controller&apos;s MAVLink stream is decoded on this device and a snapshot of the <b>latest value of every message type</b> is pushed here about once a second. No ground station is needed — it works whenever an FC link on the <b>Flight Controller</b> page is connected.</p>
          <p>The <b>summary cards</b> pull common flight values (attitude, speed, GPS, battery, status) out of the stream. The <b>inspector</b> below lists every message the FC sends with its update <b>rate</b> (Hz) and total <b>count</b>; click a row to expand its raw fields. A <b>stale</b> badge means that message has not updated in over 5&nbsp;seconds. For a fully interactive view (sending commands, graphs) connect a GCS to the TCP/UDP output instead.</p>
        </HelpSection>

        <h2>Summary</h2>
        <div className="d-flex flex-wrap" style={{ gap: '10px' }}>
          {cards.map(card => (
            <Card key={card.title} style={{ minWidth: 240, flex: '1 1 240px' }}>
              <Card.Body>
                <Card.Title style={{ fontSize: '1rem' }}>{card.title}</Card.Title>
                {card.rows.map(([label, value]) => (
                  <div className="d-flex justify-content-between" key={label}>
                    <span className="text-muted">{label}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
                  </div>
                ))}
              </Card.Body>
            </Card>
          ))}
        </div>

        <h2>All messages</h2>
        <div className="form-group row">
          <label className="col-sm-3 col-form-label">Filter<HelpTip text="Type part of a message name (e.g. GPS, BATTERY) to narrow the list below. Leave blank to show every message." /></label>
          <div className="col-sm-9">
            <input type="text" placeholder="filter by message name…" value={this.state.filter} onChange={this.handleFilter} />
          </div>
        </div>
        {this.state.telem.length === 0 ? (
          <p><i>Waiting for telemetry — connect a flight controller link on the Flight Controller page.</i></p>
        ) : (
          <Table striped bordered hover size="sm">
            <thead><tr><th>Message</th><th>Rate</th><th>ID</th><th>Count</th></tr></thead>
            <tbody>
              {rows.map(m => (
                <React.Fragment key={m.name}>
                  <tr onClick={() => this.toggleExpand(m.name)} style={{ cursor: 'pointer' }}>
                    <td>{this.state.expanded[m.name] ? '▾' : '▸'} {m.name}{m.stale && <span className="badge bg-secondary" style={{ marginLeft: '6px' }}>stale</span>}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.rate} Hz</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.msgid}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.count}</td>
                  </tr>
                  {this.state.expanded[m.name] && (
                    <tr>
                      <td colSpan={4} style={{ background: 'transparent' }}>
                        <Table size="sm" borderless className="mb-0">
                          <tbody>
                            {Object.entries(m.fields).map(([k, v]) => (
                              <tr key={k}>
                                <td className="text-muted" style={{ width: '40%' }}>{k}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{String(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    );
  }
}

export default MavInspectorPage;
