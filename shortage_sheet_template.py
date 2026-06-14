from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ShortageSheetRowDefinition:
    row_key: str
    printed_label: str
    item_category: str
    item_detail: str


@dataclass(frozen=True)
class ShortageSheetTemplate:
    template_id: str
    name: str
    description: str
    top_3x10_order: tuple[str, ...]
    footer_fields: tuple[str, ...]
    rows: tuple[ShortageSheetRowDefinition, ...]

    @property
    def row_keys(self) -> list[str]:
        return [row.row_key for row in self.rows]

    @property
    def row_lookup(self) -> dict[str, ShortageSheetRowDefinition]:
        return {row.row_key: row for row in self.rows}


SHORTAGE_V1A_TEMPLATE = ShortageSheetTemplate(
    template_id="shortage_v1a",
    name="Shortage Sheet v1A",
    description="Printed shortage sheet with 3x10 rows ordered Black, Copper, Indigo, Onyx.",
    top_3x10_order=("3x10 BLACK", "3x10 COPPER", "3x10 INDIGO", "3x10 ONYX"),
    footer_fields=(
        "dust_routes_with_uniforms",
        "soaker_pads_needed",
        "ink_towels_needed",
        "installs",
        "misc",
        "special_requests",
    ),
    rows=(
        ShortageSheetRowDefinition("3x10_black", "3x10 BLACK", "3x10", "Black"),
        ShortageSheetRowDefinition("3x10_copper", "3x10 COPPER", "3x10", "Copper"),
        ShortageSheetRowDefinition("3x10_indigo", "3x10 INDIGO", "3x10", "Indigo"),
        ShortageSheetRowDefinition("3x10_onyx", "3x10 ONYX", "3x10", "Onyx"),
        ShortageSheetRowDefinition("black_apron_x2873", "BLACK APRON - x2873", "Bulk > Aprons", "Black"),
        ShortageSheetRowDefinition("white_apron_x2864", "WHITE APRON - x2864", "Bulk > Aprons", "White"),
        ShortageSheetRowDefinition("red_apron_x2861", "RED APRON - x2861", "Bulk > Aprons", "Red"),
        ShortageSheetRowDefinition("reg_towels_x2720", "REG TOWELS - x2720", "Bulk > Towels", "Regular"),
        ShortageSheetRowDefinition("prem_towels_x5857", "PREM TOWELS - x5857", "Bulk > Towels", "Premium"),
        ShortageSheetRowDefinition("glass_towels_x2964", "GLASS TOWELS - x2964", "Bulk > Towels", "Glass"),
        ShortageSheetRowDefinition("micro_blue_x7432", "MICRO BLUE - x7432", "Bulk > Towels", "Micro Blue"),
        ShortageSheetRowDefinition("micro_orange_x7433", "MICRO ORANGE - x7433", "Bulk > Towels", "Micro Orange"),
        ShortageSheetRowDefinition("micro_grey_x7540", "MICRO GREY - x7540", "Bulk > Towels", "Micro Grey"),
        ShortageSheetRowDefinition("micro_white_x7717", "MICRO WHITE - x7717", "Bulk > Towels", "Micro White"),
        ShortageSheetRowDefinition("grid_towels_x1936", "GRID TOWELS - x1936", "Bulk > Towels", "Grid/Terry"),
        ShortageSheetRowDefinition("wet_mop_x6913", "WET MOP - x6913", "Bulk > Dust Mops", "WET MOP"),
        ShortageSheetRowDefinition("micro_tube_mop_x8020", "MICRO TUBE MOP - x8020", "Bulk > Dust Mops", "Micro Tube Mop"),
        ShortageSheetRowDefinition("20in_blue_mop_x7000", '20" BLUE MOP - x7000', "Bulk > Dust Mops", '20" Blue'),
        ShortageSheetRowDefinition("20in_grey_mop_x7540", '20" GREY MOP - x7540', "Bulk > Dust Mops", '20" Grey'),
        ShortageSheetRowDefinition("24in_dust_x2570", '24" DUST - x2570', "Bulk > Dust Mops", '24"'),
        ShortageSheetRowDefinition("36in_dust_x2590", '36" DUST - x2590', "Bulk > Dust Mops", '36"'),
        ShortageSheetRowDefinition("48in_dust_x2604", '48" DUST - x2604', "Bulk > Dust Mops", '48"'),
        ShortageSheetRowDefinition("60in_dust_x2610", '60" DUST - x2610', "Bulk > Dust Mops", '60"'),
        ShortageSheetRowDefinition("fender_covers_x2191", "FENDER COVERS - x2191", "Bulk > Dust Mops", "Fender Covers"),
        ShortageSheetRowDefinition("white_shop_towels", "WHITE SHOP TOWELS", "Bulk > Towels", "White Shop"),
        ShortageSheetRowDefinition("red_shop_towels", "RED SHOP TOWELS", "Bulk > Towels", "Red Shop"),
        ShortageSheetRowDefinition("3x5_black", "3X5 BLACK", "3x5", "Black"),
        ShortageSheetRowDefinition("3x5_onyx", "3X5 ONYX", "3x5", "Onyx"),
        ShortageSheetRowDefinition("3x5_copper", "3X5 COPPER", "3x5", "Copper"),
        ShortageSheetRowDefinition("3x5_indigo", "3X5 INDIGO", "3x5", "Indigo"),
        ShortageSheetRowDefinition("sig_series_hw_x20023", "SIG SERIES HW - x20023", "Paper", "SIG HW"),
        ShortageSheetRowDefinition("brown_hw_x9173", "BROWN HW - x9173", "Paper", "BROWN HW"),
        ShortageSheetRowDefinition("c_pull_paper_x9025", "C-PULL PAPER - x9025", "Paper", "C-PULL"),
        ShortageSheetRowDefinition("drc_airlaid_paper_x9511", "DRC AIRLAID PAPER - x9511", "Paper", "DRC (AIRLAID)"),
        ShortageSheetRowDefinition("sig_series_z_fold_x27012", "SIG SERIES Z-FOLD - x27012", "Paper", "SIG Z-FOLD"),
        ShortageSheetRowDefinition("bv_z_fold_x45695", "B&V Z-FOLD - x45695", "Paper", "B&V Z-FOLD"),
        ShortageSheetRowDefinition("jrt_toilet_paper_x9110", "JRT TOILET PAPER - x9110", "Paper", "JRT"),
        ShortageSheetRowDefinition("sig_series_tp_x27083", "SIG SERIES TP - x27083", "Paper", "SIG DUAL TP"),
        ShortageSheetRowDefinition("bv_tp_x45697", "B&V TP - x45697", "Paper", "B&V TP"),
        ShortageSheetRowDefinition("4x6_black", "4X6 BLACK", "4x6", "Black"),
        ShortageSheetRowDefinition("4x6_onyx", "4X6 ONYX", "4x6", "Onyx"),
        ShortageSheetRowDefinition("4x6_copper", "4X6 COPPER", "4x6", "Copper"),
        ShortageSheetRowDefinition("4x6_indigo", "4X6 INDIGO", "4x6", "Indigo"),
        ShortageSheetRowDefinition("urinal_mats", "URINAL MATS", "Template Items", "Urinal Mats"),
        ShortageSheetRowDefinition("toilet_mats", "TOILET MATS", "Template Items", "Toilet Mats"),
        ShortageSheetRowDefinition("3x10_traffic", "3x10 TRAFFIC", "Template Items", "3x10 Traffic"),
        ShortageSheetRowDefinition("3x5_traffic", "3x5 TRAFFIC", "Template Items", "3x5 Traffic"),
        ShortageSheetRowDefinition("4x6_traffic", "4x6 TRAFFIC", "Template Items", "4x6 Traffic"),
        ShortageSheetRowDefinition("sig_soap_x27070", "SIG SOAP - x27070", "Template Items", "SIG Soap"),
        ShortageSheetRowDefinition("small_ink_towels", "SMALL INK TOWELS", "Bulk > Towels", "Small Ink"),
        ShortageSheetRowDefinition("large_ink_towels", "LARGE INK TOWELS", "Bulk > Towels", "Large Ink"),
        ShortageSheetRowDefinition("raz_mats", "RAZ MATS", "Template Items", "Raz Mats"),
        ShortageSheetRowDefinition("soaker_pads", "SOAKER PADS", "Template Items", "Soaker Pads"),
    ),
)


def shortage_template_payload(template: ShortageSheetTemplate = SHORTAGE_V1A_TEMPLATE) -> dict[str, object]:
    return {
        "id": template.template_id,
        "name": template.name,
        "description": template.description,
        "top_3x10_order": list(template.top_3x10_order),
        "footer_fields": list(template.footer_fields),
        "row_keys": template.row_keys,
        "rows": [
            {
                "row_key": row.row_key,
                "printed_label": row.printed_label,
                "item_category": row.item_category,
                "item_detail": row.item_detail,
            }
            for row in template.rows
        ],
    }
