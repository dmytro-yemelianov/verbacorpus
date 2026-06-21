from fetch import fetch_all, raw_url


def test_raw_url():
    assert raw_url("ukr-proverbs-franko", "franko.csv") == (
        "https://raw.githubusercontent.com/MurzikVasilyevich/"
        "ukr-proverbs-franko/HEAD/franko.csv"
    )


def test_fetch_all_writes_files(tmp_path):
    calls = []

    def fake_fetcher(url: str) -> bytes:
        calls.append(url)
        return b"col\nval\n"

    written = fetch_all(dest_dir=str(tmp_path), fetcher=fake_fetcher)
    assert len(written) == len(calls) == 4
    for p in written:
        assert (tmp_path / p.split("/")[-1]).read_bytes() == b"col\nval\n"
