import io
import unittest
import zipfile
from xml.etree import ElementTree as ET

from learning.report_excel import LABELS, build_report_excel

NS = {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
      "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


class ReportExcelTests(unittest.TestCase):
    def test_charts_reference_correct_data_and_exclude_storage_from_activity(self):
        metrics = dict.fromkeys(LABELS, 3)
        metrics["current_storage_bytes"] = 999999
        data = build_report_excel(metrics, [{"day": "2026-11-10", "count": 7}],
                                  "2026-11-10T00:00:00+07:00", "2026-11-10T23:59:59+07:00")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for name in z.namelist():
                ET.fromstring(z.read(name))
            charts = [ET.fromstring(z.read(f"xl/charts/chart{i}.xml")) for i in (1, 2, 3)]
            self.assertIsNotNone(charts[0].find(".//c:barChart", NS))
            self.assertIsNotNone(charts[1].find(".//c:lineChart", NS))
            self.assertIsNotNone(charts[2].find(".//c:doughnutChart", NS))
            values = charts[0].findall(".//c:numCache/c:pt/c:v", NS)
            self.assertEqual([int(v.text) for v in values], [3] * 10)
            self.assertEqual(charts[1].find(".//c:numCache/c:pt/c:v", NS).text, "7")
            sheet = ET.fromstring(z.read("xl/worksheets/sheet2.xml"))
            for chart in charts:
                ref = chart.find(".//c:val/c:numRef/c:f", NS).text
                first, last = ref.split("!")[1].replace("$", "").split(":")
                nums = [int(sheet.find(f'.//s:c[@r="B{i}"]/s:v', NS).text)
                        for i in range(int(first[1:]), int(last[1:]) + 1)]
                cache = [int(n.text) for n in chart.findall(".//c:numCache/c:pt/c:v", NS)]
                self.assertEqual(nums, cache)

    def test_zero_data_and_english_are_valid(self):
        data = build_report_excel(dict.fromkeys(LABELS, 0),
                                  [{"day": "2026-11-10", "count": 0}], "start", "end", "en")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            text = z.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn("No submissions during this period.", text)
            self.assertIn("No downloads during this period.", text)
            self.assertIn("Activity during the period", z.read("xl/charts/chart1.xml").decode())
