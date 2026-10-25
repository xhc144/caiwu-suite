"""Independent readers for isolated, known-boundary record slices (hypotheses).

No file I/O, container walking, source export or call-graph construction.
Field descriptions are derived from public reader behavior pinned in sources.json.
Successful decoding is NOT validation of that behavior against a target PB9 file.
"""
import struct

PROFILE_VERSIONS = {0x00C1, 0x00C4}
FIXED_BYTES = {"entry_header": 26, "class_slot": 16, "object_definition": 32,
               "function_definition": 48, "parameter": 12, "type_record": 20,
               "referenced_function": 20, "routine_index": 4, "event_triple": 6,
               "call_target_descriptor": 8}
# A deliberately small fact table, not a complete instruction-length map.
KNOWN_OPS = {
    4: (0, "connect_candidate"), 5: (0, "commit_candidate"),
    6: (0, "rollback_candidate"), 7: (0, "disconnect_candidate"),
    18: (5, "super_call_candidate"),
    41: (4, "object_call_candidate"), 330: (4, "object_call_candidate"),
    331: (4, "object_call_candidate"), 366: (4, "object_call_candidate"),
    539: (4, "object_call_candidate"),
    444: (2, "push_global_function_name_candidate"),
    445: (3, "global_call_candidate"), 446: (3, "global_call_candidate"),
    447: (3, "global_call_candidate"), 448: (3, "global_call_candidate"),
    540: (3, "global_call_candidate")}


class InvalidRecord(ValueError):
    pass


def gate(version):
    if version not in PROFILE_VERSIONS:
        raise InvalidRecord("unsupported_object_version; do not substitute a runtime DLL version")


def u16(data, pos):
    return struct.unpack_from("<H", data, pos)[0]


def u32(data, pos):
    return struct.unpack_from("<I", data, pos)[0]


def type_ref(raw):
    family = raw >> 12
    return {"raw": raw, "family_nibble": family,
            "source_lookup_candidate": {0: "primitive", 4: "system_type_table",
                                        8: "entry_type_table", 12: "sentinel_unresolved"}.get(family, "unsupported"),
            "resolved_object": None}


def pool_ref(raw):
    return {"raw": raw, "bit31_set": bool(raw & 0x80000000),
            "source_masked_offset_candidate": raw & 0x7FFFFFFF,
            "equals_source_absent_sentinel_0xffff": raw == 0xFFFF,
            "bounds_checked_against_pool": False}


def call_flags(raw):
    return {"raw": raw, "post_candidate": bool(raw & 1),
            "dynamic_candidate": bool(raw & 2), "event_candidate": bool(raw & 4),
            "unknown_bits": raw & ~7}


def decode_record(kind, data, version, base_offset=0):
    """Read an exact isolated record. All returned meanings remain hypotheses."""
    gate(version)
    if kind not in FIXED_BYTES or len(data) != FIXED_BYTES[kind] or base_offset < 0:
        raise InvalidRecord("unknown kind, wrong exact record length, or negative offset")
    result = {"kind": kind, "offset": base_offset, "bytes": len(data), "object_version": version,
              "evidence_tier": "external_source_layout_hypothesis", "target_layout_validated": False}
    if kind == "entry_header":
        if u16(data, 0) != version:
            raise InvalidRecord("object header version disagrees with selected profile")
        fields = {"version": u16(data, 0), "flag_raw": u16(data, 2),
                  "entry_type_raw": u32(data, 4), "unknown_08": u32(data, 8),
                  "modified_timestamp_candidate": u32(data, 12),
                  "compiled_timestamp_candidate": u32(data, 16),
                  "unknown_14": u32(data, 20), "leading_12byte_record_count": u16(data, 24)}
    elif kind == "class_slot":
        fields = {"flag_raw": u16(data, 0), "kind_bits_candidate": (data[0] >> 1) & 7,
                  "type_ref": type_ref(u16(data, 2)), "enum_member_count_candidate": u16(data, 4)}
    elif kind == "object_definition":
        fields = {"inherit_type_candidate": type_ref(u16(data, 0)),
                  "parent_type_candidate": type_ref(u16(data, 2)),
                  "local_function_definition_count": u16(data, 4),
                  "all_function_slot_count": u16(data, 16),
                  "unknown_4byte_table_count": u16(data, 22),
                  "uninterpreted_6byte_table_count": u16(data, 24),
                  "unknown_16byte_table_count": u16(data, 26),
                  "all_variable_slot_count": u16(data, 28)}
    elif kind == "function_definition":
        flag = data[31]
        fields = {"name_pool_ref": pool_ref(u32(data, 0)),
                  "parameter_pool_ref": pool_ref(u32(data, 8)),
                  "alias_pool_ref": pool_ref(u32(data, 12)),
                  "library_pool_ref": pool_ref(u32(data, 16)),
                  "global_dispatch_slot_candidate": u16(data, 20),
                  "ref_index_raw": u16(data, 22), "return_type": type_ref(u16(data, 28)),
                  "parameter_count": data[30], "flag_raw": flag,
                  "event_candidate": bool(flag & 1), "external_candidate": bool(flag & 4),
                  "private_candidate": bool(flag & 0x10), "protected_candidate": bool(flag & 0x20),
                  "event_code_raw": u16(data, 32), "throws_type_pool_offset_candidate": u16(data, 44)}
    elif kind == "parameter":
        fields = {"name_pool_ref": pool_ref(u32(data, 0)),
                  "array_metadata_pool_ref": pool_ref(u32(data, 4)),
                  "type_ref": type_ref(u16(data, 8)), "flag_raw": data[10],
                  "read_only_candidate": bool(data[10] & 4),
                  "reference_candidate_if_not_read_only": bool(data[10] & 2) and not bool(data[10] & 4)}
    elif kind in {"type_record", "referenced_function"}:
        fields = {"name_pool_ref": pool_ref(u32(data, 8)), "byte16_raw": data[16]}
        if kind == "type_record":
            fields["referenced_object_candidate"] = data[16] == 0x40
        else:
            fields["global_dispatch_slot_candidate"] = u16(data, 12)
            fields["global_function_candidate"] = data[16] == 2
    elif kind == "routine_index":
        fields = {"word0_uninterpreted": u16(data, 0), "local_definition_index_candidate": u16(data, 2)}
    elif kind == "event_triple":
        # PbdViewer skips this table. Names below come only from a PB6-only reader.
        result["evidence_tier"] = "legacy_PB6_hypothesis_not_confirmed_by_PbdViewer"
        fields = {"word0_event_id_hypothesis": u16(data, 0),
                  "word1_reference_index_hypothesis": u16(data, 2),
                  "word2_type_id_hypothesis": u16(data, 4)}
    else:
        fields = {"dispatch_slot_candidate": u16(data, 0), "type_ref": type_ref(u16(data, 2)),
                  "name_pool_ref": pool_ref(u32(data, 4)), "receiver_type_and_inheritance_still_required": True}
    result["fields"] = fields
    return result


def decode_instruction_at_known_boundary(data, version, boundary_proven=False, base_offset=0):
    """Decode one selected opcode, never search/resynchronize arbitrary bytes."""
    gate(version)
    if not boundary_proven or len(data) < 2 or base_offset < 0:
        raise InvalidRecord("proven instruction boundary and nonnegative offset required")
    opcode = u16(data, 0)
    if opcode not in KNOWN_OPS:
        raise InvalidRecord("unsupported opcode; stop here rather than resynchronize")
    words, meaning = KNOWN_OPS[opcode]
    if len(data) != 2 + 2 * words:
        raise InvalidRecord("wrong exact instruction length")
    operands = data[2:]
    fields = {}
    if meaning == "object_call_candidate":
        fields = {"routine_buffer_descriptor_ref": pool_ref(u32(operands, 0)),
                  "argument_count": u16(operands, 4), "call_flags": call_flags(u16(operands, 6))}
    elif meaning == "super_call_candidate":
        fields = {"function_index_raw": u16(operands, 0), "argument_count": u16(operands, 2),
                  "object_type_raw": u16(operands, 4), "name_pool_ref": pool_ref(u32(operands, 6))}
    elif meaning == "push_global_function_name_candidate":
        fields = {"function_index": u16(operands, 0), "object_index_raw": u16(operands, 2)}
    elif meaning == "global_call_candidate":
        fields = {"word0_uninterpreted": u16(operands, 0), "argument_count": u16(operands, 2),
                  "call_flags": call_flags(u16(operands, 4)), "requires_prior_stack_name_provenance": True}
    return {"offset": base_offset, "bytes": len(data), "opcode": opcode,
            "meaning_candidate": meaning, "fields": fields,
            "evidence_tier": "external_source_opcode_hypothesis", "target_layout_validated": False,
            "call_edge": None}
