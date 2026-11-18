/**
 * Typography:
 * This contains all the typography config for the application
 * #Note: color and font size are defaulted as they can be overridden
 *        as required.
 *
 * A10-005：LEGACY —— FontWeights / FontSizes 已无 import 方，且 FontWeights 里写死了 color: '#000'
 * （暗色模式下会直接变成黑字）。请勿引用；字号请用 theme 的 font 尺寸键。
 */

export const FontWeights = {
  Bold: {
    fontFamily: 'SFProDisplay-Bold',
    color: '#000',
  },
  Regular: {
    fontFamily: 'SFProDisplay-Regular',
    color: '#000',
  },
  Light: {
    fontFamily: 'SFProDisplay-Light',
    color: '#000',
  },
}

export const FontSizes = {
  Heading: {
    fontSize: 32,
  },
  SubHeading: {
    fontSize: 24,
  },
  Label: {
    fontSize: 20,
  },
  Body: {
    fontSize: 16,
  },
  Caption: {
    fontSize: 14,
  },
}

export const BorderWidths = {
  normal: 0.4,
  normal1: 0.6,
  normal2: 1,
  normal3: 1.4,
  normal4: 2,
}

export const BorderRadius = {
  normal: 4,
}
