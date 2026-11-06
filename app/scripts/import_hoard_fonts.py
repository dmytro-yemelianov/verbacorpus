#!/usr/bin/env python3
"""Import every pinned native YAFF glyph without resampling or invented Unicode.

Offline authoring dependency: monobit==0.52.0. Raster availability is independent
of license status: preserve notices and leave unverified grants explicitly null.
"""
import argparse
import hashlib
import importlib.metadata
import json
import logging
from pathlib import Path
import subprocess
import monobit

UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
PIN = 'd11f085795149f7d246d365abd98b91d56b0789d'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n').encode()

def labels(glyph):
    out = []
    for label in glyph.get_labels():
        if isinstance(label, monobit.Char):
            out.append({'kind':'unicode', 'value':label.value})
        elif isinstance(label, monobit.Codepoint):
            out.append({'kind':'codepoint', 'value':'0x'+label.value.hex()})
        else:
            out.append({'kind':'tag', 'value':getattr(label, 'value', str(label))})
    return out

def coverage(glyphs):
    mapped = [g for g in glyphs if any(label['kind']=='unicode' for label in g['labels'])]
    chars = {label['value'] for g in mapped if any(int(row,16) for row in g['rows'] if row) for label in g['labels'] if label['kind']=='unicode'}
    missing = [char for char in UA if char not in chars]
    return {'glyphCount':len(glyphs), 'unicodeGlyphCount':len(mapped), 'unmappedGlyphCount':len(glyphs)-len(mapped), 'ukrainian':{'required':66, 'present':66-len(missing) if mapped else None, 'missing':missing if mapped else None, 'complete':not missing if mapped else None}}

def glyph_record(glyph, index, encoding):
    if glyph.levels != 2:
        raise ValueError('Non-binary source must be represented without thresholding')
    width, height = glyph.width, glyph.height
    row_bytes = (width+7)//8
    native = glyph.as_bytes(align='left', bit_order='big', bits_per_pixel=1)
    if len(native) != row_bytes*height:
        raise ValueError('Native byte stride mismatch')
    rows = [native[y*row_bytes:(y+1)*row_bytes].hex().upper() for y in range(height)]
    # Verify every exported bit against the actual monobit native raster.
    matrix = glyph.as_matrix()
    for y, row in enumerate(rows):
        packed = bytes.fromhex(row)
        for x in range(width):
            if int(bool(packed[x//8] & (128>>(x%8)))) != matrix[y][x]:
                raise ValueError('Native raster round trip differs')
    source_labels = labels(glyph)
    chars = [label['value'] for label in source_labels if label['kind']=='unicode']
    character = next((char for char in chars if len(char)==1), chars[0] if chars else None)
    codepoint = f'U+{ord(character):04X}' if character is not None and len(character)==1 else None
    code = next((label['value'] for label in source_labels if label['kind']=='codepoint'), None)
    record = {'id':f'g{index:06d}', 'codepoint':codepoint, 'character':character, 'labels':source_labels,
        'width':width, 'height':height, 'rowBytes':row_bytes, 'advanceX':glyph.advance_width,
        'metrics':{'leftBearing':glyph.left_bearing, 'rightBearing':glyph.right_bearing, 'shiftUp':glyph.shift_up,
                   'topBearing':glyph.top_bearing, 'bottomBearing':glyph.bottom_bearing, 'shiftLeft':glyph.shift_left, 'advanceY':glyph.advance_height},
        'rows':rows, 'sourceCode':{'encoding':encoding or 'unmapped', 'value':code}}
    comment = glyph.comment
    if comment:
        record['comment'] = comment
    return record

def source_notices(root, source):
    notices = []
    for directory in [root, *reversed(source.parent.relative_to(root).parents), source.parent.relative_to(root)]:
        directory = directory if directory.is_absolute() else root/directory
        for path in sorted(directory.iterdir()):
            if path.is_file() and path.name.lower().startswith(('license','copying','copyright','readme')):
                rel = path.relative_to(root).as_posix()
                if any(n['path']==rel for n in notices):
                    continue
                raw = path.read_bytes()
                notices.append({'path':rel, 'sha256':digest(raw), 'text':raw.decode('utf-8',errors='replace')})
    return notices

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--metadata',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    if importlib.metadata.version('monobit') != '0.52.0':
        raise ValueError('Use pinned monobit==0.52.0')
    logging.disable(logging.CRITICAL)
    root=args.source.resolve()
    if subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()!=PIN:
        raise ValueError('Hoard revision differs from the catalog pin')
    metadata=json.loads(args.metadata.read_text())
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'Hoard-LICENSE.md').write_bytes((root/'LICENSE.md').read_bytes())
    descriptors=[]; total_glyphs=0; files=0
    for meta in metadata:
        relative=Path(meta['source']['file'])
        source=(root/relative).resolve()
        if not source.is_relative_to(root):
            raise ValueError('Source escapes pinned checkout')
        raw=source.read_bytes()
        if digest(raw)!=meta['source']['fileSha256']:
            raise ValueError(f'Source checksum differs: {relative}')
        faces=monobit.load(source)
        if not faces:
            raise ValueError(f'No native font in {relative}')
        for index,font in enumerate(faces):
            glyphs=[glyph_record(g,i,font.encoding) for i,g in enumerate(font.glyphs)]
            if not glyphs:
                raise ValueError(f'Empty native font: {relative}')
            identifier=meta['id'] if index==0 else f"{meta['id']}-face-{index}"
            w=max(1,font.raster_size.x);h=max(1,font.raster_size.y)
            record={'format':'para-font', 'schemaVersion':'2.0.0','id':identifier,'name':font.name or meta['family'],'family':font.family or meta['family'],'version':1,'kind':'native','availability':'raster',
                'cell':{'width':w,'height':h,'monospace':font.spacing in ('character-cell','monospace'),'pixelAspectRatio':{'x':1,'y':1}},
                'metrics':{'ascent':font.ascent,'descent':font.descent,'baseline':font.ascent,'lineGap':font.line_height-font.ascent-font.descent,'lineHeight':font.line_height,'advanceX':font.average_width},
                'bitmap':{'encoding':'hex-rows','bitOrder':'msb-first','bitsPerPixel':1},
                'encodings':[{'name':font.encoding or 'unmapped','primary':True}],
                'license':{'id':'NOASSERTION','name':'Original source terms retained','status':'unverified','redistributionAllowed':None,'attributionRequired':True,'attribution':font.copyright or meta['license']['attribution'],'url':meta['license']['url'],'sourceNotices':source_notices(root,source),'copyright':font.copyright,'sourceLicense':getattr(font,'license','')},
                'source':{'collection':'hoard','recordId':meta['id'],'revision':PIN,'sha256':digest(raw),'upstream':{**meta['source'],'packIndex':index}},
                'provenance':{'decoder':'monobit 0.52.0','nativeGlyphs':len(glyphs),'packIndex':index,'sourceHeader':font.get_comment(),'rasterSha256':digest(encode(glyphs)),'transformation':'Native glyph rasters and metrics; no resizing, thresholding or invented Unicode labels.'},
                'modifications':[],'coverage':coverage(glyphs),'glyphs':glyphs}
            blob=encode(record)
            path=args.output/(identifier+'.json');path.write_bytes(blob)
            descriptors.append({'id':identifier,'file':path.name,'sha256':digest(blob),'glyphs':len(glyphs)})
            total_glyphs+=len(glyphs)
        files+=1
        if files%200==0:
            print(f'Imported {files}/{len(metadata)} source files, {total_glyphs} native glyphs',flush=True)
    (args.output/'manifest.json').write_bytes(encode({'sourceFiles':files,'faces':len(descriptors),'glyphs':total_glyphs,'revision':PIN,'fonts':descriptors}))
    print(f'Complete: {files} files, {len(descriptors)} faces, {total_glyphs} glyphs',flush=True)

if __name__=='__main__':
    main()
