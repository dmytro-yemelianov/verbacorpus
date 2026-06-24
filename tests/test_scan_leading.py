from expand.scan_leading import classify

def test_classify():
    assert classify("Без труда.") == "upper"
    assert classify("«А ви з віхті?»") == "quote"
    assert classify('"А?"') == "quote"
    assert classify("Ѣсти.") == "yat"
    assert classify("старі люде.") == "lower"
    assert classify("Toto має.") == "latin"      # leading Latin T
    assert classify("1 старі.") == "digit"
    assert classify("| якесь.") == "punct"
    assert classify("") == "empty"
