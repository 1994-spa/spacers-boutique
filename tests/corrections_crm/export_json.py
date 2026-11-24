# Convertit l'export xlsx du CRM en JSON {onglet: {"r,c": valeur}} pour la maquette Node.
# Les dates sont codées {"$d": [a, m, j, h, mi, s]} (heure locale du classeur).
import sys, json, datetime, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
out = {}
for ws in wb.worksheets:
    g = {}
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        for j, v in enumerate(row, 1):
            if v is None or v == '':
                continue
            if isinstance(v, datetime.datetime):
                v = {'$d': [v.year, v.month, v.day, v.hour, v.minute, v.second]}
            elif isinstance(v, datetime.date):
                v = {'$d': [v.year, v.month, v.day, 0, 0, 0]}
            elif isinstance(v, datetime.time):
                v = {'$d': [1899, 12, 30, v.hour, v.minute, v.second]}
            g['%d,%d' % (i, j)] = v
    out[ws.title] = g
json.dump(out, sys.stdout, ensure_ascii=False)
