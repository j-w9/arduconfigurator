// Tuning ▸ Notches: the two harmonic notches side by side (they are the same
// ten settings: INS_HNTCH_* and INS_HNTC2_*), the FILTn bank with its slots
// across, and which slot each rate axis filters through. Presentational: App
// supplies values and staging (views/PilotFeel's FeelGrid and value shape).

import type { ReactElement, ReactNode } from 'react'

import { FeelGrid, type PilotFeelValue } from './PilotFeel'

type Pair = [PilotFeelValue | undefined, PilotFeelValue | undefined]

export interface NotchesViewProps {
  notch: {
    enable: Pair
    mode: Pair
    ref: Pair
    freq: Pair
    bw: Pair
    att: Pair
    fmRat: Pair
    harmonics: Pair
    options: Pair
  }
  /** Per-notch warnings (REF 0 on an enabled notch), under its column. */
  notchFooter: [ReactNode, ReactNode]
  bank?: {
    slots: { index: number; summary: string }[]
    inUse: number
    type: (PilotFeelValue | undefined)[]
    freq: (PilotFeelValue | undefined)[]
    q: (PilotFeelValue | undefined)[]
    att: (PilotFeelValue | undefined)[]
    routing: { target: (PilotFeelValue | undefined)[]; error: (PilotFeelValue | undefined)[] }
  }
}

export function NotchesView({ notch, notchFooter, bank }: NotchesViewProps): ReactElement {
  return (
    <div className="pilot-feel" data-testid="notches">
      <section className="bf-gui-box pilot-feel-card" data-testid="notches-harmonic">
        <div className="bf-gui-box__titlebar">
          <strong>Harmonic notches</strong>
        </div>
        <div className="bf-gui-box__body">
          <FeelGrid
            testId="notches-grid"
            columns={['Notch 1', 'Notch 2']}
            rows={[
              { label: 'Enabled', cells: notch.enable },
              { label: 'Tracking', cells: notch.mode },
              { label: 'Reference', cells: notch.ref },
              { label: 'Frequency', cells: notch.freq },
              { label: 'Bandwidth', cells: notch.bw },
              { label: 'Attenuation', cells: notch.att },
              { label: 'Min freq ratio', cells: notch.fmRat },
              { label: 'Harmonics', cells: notch.harmonics },
              { label: 'Options', cells: notch.options }
            ]}
            footer={notchFooter}
          />
        </div>
      </section>

      {bank ? (
        <section className="bf-gui-box pilot-feel-card" data-testid="filter-bank">
          <div className="bf-gui-box__titlebar">
            <strong>Filter bank</strong>
            <small className="pilot-feel-card__modes">
              {bank.inUse} of {bank.slots.length} in use
            </small>
          </div>
          <div className="bf-gui-box__body">
            <FeelGrid
              testId="filter-bank-grid"
              columns={bank.slots.map((slot) => `FILT${slot.index}`)}
              rows={[
                { label: 'Type', cells: bank.type },
                { label: 'Frequency', cells: bank.freq },
                { label: 'Q', cells: bank.q },
                { label: 'Attenuation', cells: bank.att }
              ]}
            />
            <FeelGrid
              testId="filter-bank-routing"
              columns={['Roll', 'Pitch', 'Yaw']}
              rows={[
                { label: 'Target filter', cells: bank.routing.target },
                { label: 'Error filter', cells: bank.routing.error }
              ]}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
