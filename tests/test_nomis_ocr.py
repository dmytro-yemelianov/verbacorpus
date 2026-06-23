from expand.nomis_ocr import column_boxes


def test_column_boxes_splits_with_overlap():
    boxes = column_boxes(1000, 1400, overlap=20)
    assert boxes == [(0, 0, 520, 1400), (480, 0, 1000, 1400)]


def test_column_boxes_odd_width():
    left, right = column_boxes(1001, 100, overlap=0)
    assert left == (0, 0, 500, 100)
    assert right == (500, 0, 1001, 100)
