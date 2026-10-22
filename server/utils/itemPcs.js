// Order_Items written the way the IMS counts stock: everything in pieces.
//  - sold in pieces: the colour itself and the number of pieces
//  - sold in boxes:  colour "Mix Color", pieces = boxes x pieces per box,
//                    plus the number of boxes and pieces per box
export const MIX_COLOR = 'Mix Color';

export function pcsColumns(item) {
  const qty = Number(item.qty) || 0;
  if (item.inventory_mode_snapshot !== 'BOX_WISE') {
    return { item_colour: item.color_snapshot || '', qty_pcs: qty, sold_in: 'Pcs', boxes: null, pcs_per_box: null };
  }
  const perBox = Number(item.units_per_box_snapshot) || 1;
  return { item_colour: MIX_COLOR, qty_pcs: qty * perBox, sold_in: 'Box', boxes: qty, pcs_per_box: perBox };
}
