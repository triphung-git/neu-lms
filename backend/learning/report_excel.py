"""Small OOXML report exporter; no optional runtime dependencies."""
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
LABELS = {
    "new_users": ("Tài khoản mới", "New users"),
    "new_courses": ("Môn mới", "New courses"),
    "enrollments": ("Ghi danh mới", "New enrollments"),
    "submissions": ("Bài nộp cá nhân", "Individual submissions"),
    "group_submissions": ("Bài nộp nhóm", "Group submissions"),
    "attendance_checkins": ("Lượt điểm danh", "Check-ins"),
    "downloads": ("Lượt tải", "Downloads"),
    "completed_lessons": ("Bài học hoàn thành", "Completed lessons"),
    "appeals": ("Phúc khảo", "Appeals"),
    "library_documents": ("Tài liệu thư viện mới", "New library documents"),
    "current_storage_bytes": ("Dung lượng hiện tại (byte)", "Current storage (bytes)"),
}


def cell(ref, value):
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


def sheet(rows, drawing=False):
    data = "".join(
        f'<row r="{i}">' + "".join(cell(f"{chr(65+j)}{i}", v) for j, v in enumerate(row)) + "</row>"
        for i, row in enumerate(rows, 1)
    )
    return (
        f'<worksheet xmlns="{S}" xmlns:r="{R}"><sheetViews><sheetView workbookViewId="0" '
        'showGridLines="0"/></sheetViews><cols><col min="1" max="1" width="38" customWidth="1"/>'
        '<col min="2" max="3" width="24" customWidth="1"/></cols>'
        f'<sheetData>{data}</sheetData>'
        + ('<drawing r:id="rId1"/>' if drawing else "") + "</worksheet>"
    )


def rels(items):
    return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(
        f'<Relationship Id="rId{i}" Type="{R}/{kind}" Target="{target}"/>'
        for i, (kind, target) in enumerate(items, 1)
    ) + "</Relationships>"


def chart(kind, title, categories, values, cat_ref, val_ref):
    cats = "".join(f'<c:pt idx="{i}"><c:v>{escape(str(v))}</c:v></c:pt>' for i, v in enumerate(categories))
    nums = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(values))
    series = (
        '<c:ser><c:idx val="0"/><c:order val="0"/>'
        '<c:spPr><a:solidFill><a:srgbClr val="0284C7"/></a:solidFill>'
        '<a:ln w="28575"><a:solidFill><a:srgbClr val="0284C7"/></a:solidFill></a:ln></c:spPr>'
    )
    if kind == "doughnut":
        for i, color in enumerate(["0284C7", "7C3AED"]):
            series += f'<c:dPt><c:idx val="{i}"/><c:spPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></c:spPr></c:dPt>'
    series += (
        f'<c:cat><c:strRef><c:f>{cat_ref}</c:f><c:strCache><c:ptCount val="{len(categories)}"/>{cats}</c:strCache></c:strRef></c:cat>'
        f'<c:val><c:numRef><c:f>{val_ref}</c:f><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="{len(values)}"/>{nums}</c:numCache></c:numRef></c:val></c:ser>'
    )
    axes = ""
    if kind == "doughnut":
        plot = f'<c:doughnutChart><c:varyColors val="1"/>{series}<c:firstSliceAng val="270"/><c:holeSize val="65"/></c:doughnutChart>'
    else:
        opts = '<c:barDir val="bar"/><c:grouping val="clustered"/>' if kind == "bar" else '<c:grouping val="standard"/>'
        plot = f'<c:{kind}Chart>{opts}{series}<c:axId val="10"/><c:axId val="20"/></c:{kind}Chart>'
        for tag, ident, cross, pos in [("catAx", 10, 20, "l" if kind == "bar" else "b"), ("valAx", 20, 10, "b" if kind == "bar" else "l")]:
            axes += f'<c:{tag}><c:axId val="{ident}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="{pos}"/><c:crossAx val="{cross}"/><c:crosses val="autoZero"/></c:{tag}>'
    return (
        f'<c:chartSpace xmlns:c="{C}" xmlns:a="{A}"><c:chart><c:title><c:tx><c:rich>'
        f'<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{escape(title)}</a:t></a:r></a:p>'
        f'</c:rich></c:tx></c:title><c:plotArea><c:layout/>{plot}{axes}</c:plotArea>'
        + ('<c:legend><c:legendPos val="b"/></c:legend>' if kind == "doughnut" else "")
        + '<c:plotVisOnly val="1"/></c:chart></c:chartSpace>'
    )


def build_report_excel(metrics, trend, start, end, language="vi"):
    en = language == "en"
    tr = lambda vi, eng: eng if en else vi
    bars = [(LABELS.get(k, (k, k))[int(en)], v) for k, v in metrics.items() if k != "current_storage_bytes"]
    data = [[tr("Chỉ số", "Metric"), tr("Giá trị", "Value")]] + [
        [LABELS.get(k, (k, k))[int(en)], v] for k, v in metrics.items()
    ]
    trend_start = len(data) + 3
    data += [[], [tr("Ngày tải", "Download date"), tr("Lượt tải", "Downloads")]]
    data += [[str(x["day"]), x["count"]] for x in trend]
    group_start = len(data) + 3
    data += [[], [tr("Loại bài nộp", "Submission type"), tr("Số lượng", "Count")],
             [tr("Cá nhân", "Individual"), metrics.get("submissions", 0)],
             [tr("Nhóm", "Group"), metrics.get("group_submissions", 0)]]
    titles = [tr("Hoạt động trong kỳ", "Activity during the period"), tr("Xu hướng tải tài liệu", "Document download trend"), tr("Cơ cấu bài nộp", "Submission breakdown")]
    report = [[tr("BÁO CÁO HỆ THỐNG NEU LMS", "NEU LMS SYSTEM REPORT")],
              [tr("Từ", "From"), str(start)], [tr("Đến", "To"), str(end)],
              [tr("Nguồn: báo cáo hệ thống; thời gian có múi giờ.", "Source: system reports; timestamps include timezone.")]]
    if not any(x["count"] for x in trend):
        report.append([tr("Chưa có lượt tải trong kỳ.", "No downloads during this period.")])
    if not metrics.get("submissions", 0) + metrics.get("group_submissions", 0):
        report.append([tr("Chưa có bài nộp trong kỳ.", "No submissions during this period.")])
    specs = [
        ("bar", titles[0], [x[0] for x in bars], [x[1] for x in bars], 2, len(bars)+1),
        ("line", titles[1], [str(x["day"]) for x in trend], [x["count"] for x in trend], trend_start, trend_start+len(trend)-1),
        ("doughnut", titles[2], [tr("Cá nhân", "Individual"), tr("Nhóm", "Group")], [metrics.get("submissions", 0), metrics.get("group_submissions", 0)], group_start, group_start+1),
    ]
    out = BytesIO()
    with ZipFile(out, "w", ZIP_DEFLATED) as z:
        overrides = [("/xl/workbook.xml", "spreadsheetml.sheet.main+xml"),
                     ("/xl/worksheets/sheet1.xml", "spreadsheetml.worksheet+xml"),
                     ("/xl/worksheets/sheet2.xml", "spreadsheetml.worksheet+xml"),
                     ("/xl/drawings/drawing1.xml", "drawing+xml")]
        overrides += [(f"/xl/charts/chart{i}.xml", "drawingml.chart+xml") for i in range(1,4)]
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + "".join(f'<Override PartName="{p}" ContentType="application/vnd.openxmlformats-officedocument.{t}"/>' for p,t in overrides) + "</Types>")
        z.writestr("_rels/.rels", rels([("officeDocument", "xl/workbook.xml")]))
        z.writestr("xl/workbook.xml", f'<workbook xmlns="{S}" xmlns:r="{R}"><sheets><sheet name="Báo cáo" sheetId="1" r:id="rId1"/><sheet name="Dữ liệu" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", rels([("worksheet","worksheets/sheet1.xml"),("worksheet","worksheets/sheet2.xml")]))
        z.writestr("xl/worksheets/sheet1.xml", sheet(report, True))
        z.writestr("xl/worksheets/sheet2.xml", sheet(data))
        z.writestr("xl/worksheets/_rels/sheet1.xml.rels", rels([("drawing","../drawings/drawing1.xml")]))
        anchors = ""
        for i, (kind, title, cats, vals, first, last) in enumerate(specs, 1):
            z.writestr(f"xl/charts/chart{i}.xml", chart(kind,title,cats,vals,f"'Dữ liệu'!$A${first}:$A${last}",f"'Dữ liệu'!$B${first}:$B${last}"))
            anchors += f'<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{8+(i-1)*25}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{32+(i-1)*25}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{i}" name="Chart {i}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="{C}"><c:chart xmlns:c="{C}" r:id="rId{i}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>'
        z.writestr("xl/drawings/drawing1.xml", f'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="{A}" xmlns:r="{R}">{anchors}</xdr:wsDr>')
        z.writestr("xl/drawings/_rels/drawing1.xml.rels", rels([("chart",f"../charts/chart{i}.xml") for i in range(1,4)]))
    return out.getvalue()
