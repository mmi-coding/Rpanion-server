import React, { useState } from 'react';
import { OverlayTrigger, Tooltip, Collapse } from 'react-bootstrap';

/*
 * Self-documentation building blocks - see docs/UI-GUIDELINES.md.
 *
 * Every control gets a <HelpTip> explaining what it does and what to put in
 * it; every page/section gets its longer explanation in a <HelpSection>
 * (collapsed by default) instead of paragraphs of always-visible prose.
 */

// Small "?" marker that explains the control next to it on hover/focus/tap.
export function HelpTip({ text, placement = 'right' }) {
    return (
        <OverlayTrigger placement={placement} overlay={<Tooltip>{text}</Tooltip>}>
            <span
                tabIndex={0}
                aria-label="help"
                style={{
                    display: 'inline-block',
                    marginLeft: '6px',
                    width: '16px',
                    height: '16px',
                    lineHeight: '16px',
                    textAlign: 'center',
                    borderRadius: '50%',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'help',
                    userSelect: 'none',
                    verticalAlign: 'text-top'
                }}>?</span>
        </OverlayTrigger>
    );
}

// Collapsible explanation block, collapsed by default so the page stays
// compact but the full story is one click away.
export function HelpSection({ title = 'How this works', defaultOpen = false, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ marginBottom: '10px' }}>
            <a
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
                style={{ cursor: 'pointer', userSelect: 'none', fontSize: '0.9em', textDecoration: 'none' }}>
                {open ? '▾' : '▸'} {title}
            </a>
            <Collapse in={open}>
                <div>
                    <div className="text-muted" style={{ fontSize: '0.9em', padding: '8px 12px', borderLeft: '3px solid #dee2e6', marginTop: '4px', maxWidth: '750px' }}>
                        {children}
                    </div>
                </div>
            </Collapse>
        </div>
    );
}
