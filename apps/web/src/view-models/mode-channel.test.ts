import { describe, expect, it } from 'vitest'

import { functionPickDrafts, modeChannelPickDrafts } from './mode-channel'

describe('modeChannelPickDrafts', () => {
  it('names the channel and clears a function already on it', () => {
    expect(modeChannelPickDrafts('FLTMODE_CH', 6, (channel) => (channel === 6 ? 153 : 0))).toEqual({
      FLTMODE_CH: '6',
      RC6_OPTION: '0'
    })
  })

  it('leaves a channel with no function alone', () => {
    expect(modeChannelPickDrafts('MODE_CH', 8, () => 0)).toEqual({ MODE_CH: '8' })
  })

  it('disabling the mode switch touches no function', () => {
    expect(modeChannelPickDrafts('FLTMODE_CH', 0, () => 153)).toEqual({ FLTMODE_CH: '0' })
  })
})

describe('functionPickDrafts', () => {
  it('takes the mode switch off the channel a function is picked on', () => {
    expect(functionPickDrafts('FLTMODE_CH', 5, 5, 153)).toEqual({ RC5_OPTION: '153', FLTMODE_CH: '0' })
  })

  it('leaves the mode switch on another channel alone', () => {
    expect(functionPickDrafts('FLTMODE_CH', 5, 7, 153)).toEqual({ RC7_OPTION: '153' })
  })

  it('clearing the function on the mode channel keeps the mode switch', () => {
    expect(functionPickDrafts('FLTMODE_CH', 5, 5, 0)).toEqual({ RC5_OPTION: '0' })
  })
})
