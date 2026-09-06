"""Grid-weld the voxel figure GLB into a lightweight mesh for the exhibit."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "models" / "voxel-figure.glb"
DST = ROOT / "assets" / "models" / "voxel-figure-low.glb"
RES_Y = 64


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    off = 12
    json_chunk = None
    bin_chunk = b""
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        off += 8
        payload = data[off : off + clen]
        off += clen
        if ctype == b"JSON":
            json_chunk = json.loads(payload)
        elif ctype == b"BIN\x00":
            bin_chunk = payload
    if json_chunk is None:
        raise RuntimeError("no JSON chunk")
    return json_chunk, bin_chunk


def accessor_bytes(doc: dict, blob: bytes, index: int) -> bytes:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[acc["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    return blob[start : start + acc["count"] * comp * n]


def weld(positions: list[float], indices: list[int], res_y: int) -> tuple[list[float], list[int]]:
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    sx = max(max_x - min_x, 1e-6)
    sy = max(max_y - min_y, 1e-6)
    sz = max(max_z - min_z, 1e-6)
    res_x = max(8, round(res_y * sx / sy))
    res_z = max(6, round(res_y * sz / sy))
    table: dict[tuple[int, int, int], int] = {}
    out: list[float] = []

    def quant(i: int) -> int:
        x, y, z = positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]
        key = (
            int(round((x - min_x) / sx * res_x)),
            int(round((y - min_y) / sy * res_y)),
            int(round((z - min_z) / sz * res_z)),
        )
        found = table.get(key)
        if found is None:
            found = len(out) // 3
            table[key] = found
            out.extend(
                (
                    min_x + key[0] / res_x * sx,
                    min_y + key[1] / res_y * sy,
                    min_z + key[2] / res_z * sz,
                )
            )
        return found

    new_idx: list[int] = []
    for t in range(0, len(indices), 3):
        a, b, c = quant(indices[t]), quant(indices[t + 1]), quant(indices[t + 2])
        if a != b and b != c and c != a:
            new_idx.extend((a, b, c))
    return out, new_idx


def normals_and_uvs(positions: list[float], indices: list[int]) -> tuple[list[float], list[float]]:
    nvert = len(positions) // 3
    nrm = [0.0] * (nvert * 3)
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        ax, ay, az = positions[ia * 3 : ia * 3 + 3]
        bx, by, bz = positions[ib * 3 : ib * 3 + 3]
        cx, cy, cz = positions[ic * 3 : ic * 3 + 3]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        for i in (ia, ib, ic):
            nrm[i * 3] += nx
            nrm[i * 3 + 1] += ny
            nrm[i * 3 + 2] += nz
    for i in range(nvert):
        nx, ny, nz = nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]
        length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        nrm[i * 3] = nx / length
        nrm[i * 3 + 1] = ny / length
        nrm[i * 3 + 2] = nz / length
    xs = positions[0::3]
    ys = positions[1::3]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    sx = max(max_x - min_x, 1e-6)
    sy = max(max_y - min_y, 1e-6)
    uvs: list[float] = []
    for i in range(nvert):
        uvs.append((positions[i * 3] - min_x) / sx)
        uvs.append((positions[i * 3 + 1] - min_y) / sy)
    return nrm, uvs


def pack_f32(values: list[float]) -> bytes:
    return struct.pack(f"<{len(values)}f", *values)


def pack_u32(values: list[int]) -> bytes:
    return struct.pack(f"<{len(values)}I", *values)


def align4(buf: bytes, pad: bytes = b"\x00") -> bytes:
    n = (4 - (len(buf) % 4)) % 4
    return buf + pad * n


def write_glb(path: Path, positions: list[float], normals: list[float], uvs: list[float], indices: list[int]) -> None:
    pos_b = pack_f32(positions)
    nrm_b = pack_f32(normals)
    uv_b = pack_f32(uvs)
    idx_b = pack_u32(indices)
    blob = pos_b + nrm_b + uv_b + idx_b
    nvert = len(positions) // 3
    xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
    doc = {
        "asset": {"version": "2.0", "generator": "simplify_voxel"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                        "indices": 3,
                    }
                ]
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": nvert,
                "type": "VEC3",
                "max": [max(xs), max(ys), max(zs)],
                "min": [min(xs), min(ys), min(zs)],
            },
            {"bufferView": 1, "componentType": 5126, "count": nvert, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": nvert, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5125, "count": len(indices), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_b)},
            {"buffer": 0, "byteOffset": len(pos_b), "byteLength": len(nrm_b)},
            {"buffer": 0, "byteOffset": len(pos_b) + len(nrm_b), "byteLength": len(uv_b)},
            {
                "buffer": 0,
                "byteOffset": len(pos_b) + len(nrm_b) + len(uv_b),
                "byteLength": len(idx_b),
                "target": 34963,
            },
        ],
        "buffers": [{"byteLength": len(blob)}],
    }
    json_bytes = align4(json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" ")
    bin_bytes = align4(blob, b"\x00")
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    header = struct.pack("<3I", 0x46546C67, 2, total)
    json_head = struct.pack("<I4s", len(json_bytes), b"JSON")
    bin_head = struct.pack("<I4s", len(bin_bytes), b"BIN\x00")
    path.write_bytes(header + json_head + json_bytes + bin_head + bin_bytes)


def main() -> None:
    print("reading", SRC)
    doc, blob = read_glb(SRC)
    prim = doc["meshes"][0]["primitives"][0]
    pos = list(struct.unpack(f"<{doc['accessors'][prim['attributes']['POSITION']]['count'] * 3}f", accessor_bytes(doc, blob, prim["attributes"]["POSITION"])))
    raw_idx = accessor_bytes(doc, blob, prim["indices"])
    count = doc["accessors"][prim["indices"]]["count"]
    ctype = doc["accessors"][prim["indices"]]["componentType"]
    fmt = {5123: "H", 5125: "I"}[ctype]
    indices = list(struct.unpack(f"<{count}{fmt}", raw_idx))
    print("input verts", len(pos) // 3, "tris", len(indices) // 3)
    welded, new_idx = weld(pos, indices, RES_Y)
    nrm, uvs = normals_and_uvs(welded, new_idx)
    print("output verts", len(welded) // 3, "tris", len(new_idx) // 3)
    write_glb(DST, welded, nrm, uvs, new_idx)
    print("wrote", DST, "bytes", DST.stat().st_size)


if __name__ == "__main__":
    main()
