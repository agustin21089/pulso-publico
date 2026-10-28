"""Scientific core. No interpolation, no empirical accuracy claims; all arrays share one metric grid."""
import numpy as np

def normalized_difference(a, b):
    a, b = np.asarray(a, dtype='float32'), np.asarray(b, dtype='float32')
    denominator = a + b
    good = np.isfinite(a) & np.isfinite(b) & (a >= 0) & (b >= 0) & (denominator > 1e-6)
    out = np.full(a.shape, np.nan, dtype='float32')
    np.divide(a - b, denominator, out=out, where=good)
    return out

def quality_mask(scl, inside, valid_scl=(4, 5, 6), buffer_pixels=2):
    # SCL 0/1 invalid, 2 dark/shadow, 3 shadow, 7 unclassified, 8/9 cloud, 10 cirrus, 11 snow.
    valid = np.isin(scl, valid_scl) & inside
    bad = np.isin(scl, [2, 3, 8, 9, 10])
    padded = np.pad(bad, buffer_pixels)
    for y in range(2 * buffer_pixels + 1):
        for x in range(2 * buffer_pixels + 1):
            valid &= ~padded[y:y+scl.shape[0], x:x+scl.shape[1]]
    return valid

def classify(green, nir, swir, red, scl, inside, settings):
    ndwi = normalized_difference(green, nir)
    mndwi = normalized_difference(green, swir)
    ndvi = normalized_difference(nir, red)
    valid = quality_mask(scl, inside, settings['validScl'], settings['cloudBufferPixels'])
    valid &= np.isfinite(ndwi) & np.isfinite(mndwi) & np.isfinite(ndvi)
    t = settings['thresholds']
    water = valid & (ndwi > t['ndwi']) & (mndwi > t['mndwi']) & (ndvi < t['maxNdvi'])
    # 0 unknown, 1 observed non-water, 2 classified open water; 255 outside AOI.
    mask = np.where(inside, np.where(valid, np.where(water, 2, 1), 0), 255).astype('uint8')
    return mask, ndwi, mndwi

def areas(mask, pixel_area):
    if not np.isfinite(pixel_area) or pixel_area <= 0: raise ValueError('Pixel area must be positive m²')
    factor = pixel_area / 1e6
    valid = (mask == 1) | (mask == 2)
    return {'waterAreaKm2': float(np.sum(mask == 2) * factor),
            'validAreaKm2': float(np.sum(valid) * factor),
            'aoiRasterAreaKm2': float(np.sum(mask != 255) * factor),
            'validCoverage': float(np.sum(valid) / max(1, np.sum(mask != 255))),
            'waterFraction': float(np.sum(mask == 2) / np.sum(valid)) if np.any(valid) else None}

def changes(a, b, pixel_area):
    if a.shape != b.shape: raise ValueError('Different grid shapes')
    comparable = np.isin(a, [1, 2]) & np.isin(b, [1, 2])
    f = pixel_area / 1e6
    gained = comparable & (a == 1) & (b == 2)
    lost = comparable & (a == 2) & (b == 1)
    persistent = comparable & (a == 2) & (b == 2)
    area_a = float(np.sum(comparable & (a == 2)) * f)
    area_b = float(np.sum(comparable & (b == 2)) * f)
    result = {'comparableAreaKm2': float(np.sum(comparable) * f), 'waterAreaAKm2': area_a,
              'waterAreaBKm2': area_b, 'gainedWaterKm2': float(np.sum(gained) * f),
              'lostWaterKm2': float(np.sum(lost) * f), 'netChangeKm2': area_b-area_a,
              'percentageChange': (area_b-area_a) / area_a * 100 if area_a > 0 else None,
              'qualityStatus': 'satellite_estimate_unvalidated'}
    layer = np.zeros(a.shape, dtype='uint8')
    layer[persistent] = 1; layer[gained] = 2; layer[lost] = 3
    layer[~comparable & ((a != 255) | (b != 255))] = 4
    return result, layer
