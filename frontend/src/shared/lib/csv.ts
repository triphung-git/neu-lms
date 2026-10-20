/**
 * RFC 4180 compliant CSV parser for NPC LMS admin import
 * Supports: quotes, commas within quoted cells, CRLF/LF, UTF-8 BOM
 */

import { removeVietnameseAccents } from './search';

export interface ParsedCSVRow {
  index: number;
  rawEmail: string;
  rawFullName: string;
  rawRole: string;
  emailNormalized: string;
  fullName: string;
  assignedRole: 'teacher' | 'student' | null;
  isValid: boolean;
  errorMessage?: string;
}

export interface CSVParseResult {
  totalRows: number;
  validRows: ParsedCSVRow[];
  invalidRows: ParsedCSVRow[];
  headers: string[];
}

export function parseCSV(content: string): CSVParseResult {
  // Strip UTF-8 BOM if present
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xFEFF) {
    cleanContent = cleanContent.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < cleanContent.length; i++) {
    const char = cleanContent[i];
    const nextChar = cleanContent[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // Skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip LF in CRLF
      }
      currentRow.push(currentCell.trim());
      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return { totalRows: 0, validRows: [], invalidRows: [], headers: [] };
  }

  // Header detection
  const normalizedHeaders = rows[0].map((h) => removeVietnameseAccents(h.toLowerCase().trim()));
  const emailCol = normalizedHeaders.findIndex((h) => h.includes('email'));
  const nameCol = normalizedHeaders.findIndex((h) => h.includes('ten') || h.includes('name') || h.includes('ho va ten') || h.includes('ho_va_ten'));
  const roleCol = normalizedHeaders.findIndex((h) => h.includes('vai tro') || h.includes('vai_tro') || h.includes('role'));

  const parsedValid: ParsedCSVRow[] = [];
  const parsedInvalid: ParsedCSVRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawEmail = (emailCol !== -1 ? row[emailCol] : row[0]) || '';
    const rawFullName = (nameCol !== -1 ? row[nameCol] : row[1]) || '';
    const rawRole = (roleCol !== -1 ? row[roleCol] : row[2]) || '';

    const emailTrim = rawEmail.trim().toLowerCase();
    const fullNameTrim = rawFullName.trim();
    const roleLower = removeVietnameseAccents(rawRole.toLowerCase().trim());

    let assignedRole: 'teacher' | 'student' | null = null;
    if (roleLower.includes('giang') || roleLower.includes('teacher') || roleLower === 'gv') {
      assignedRole = 'teacher';
    } else if (roleLower.includes('sinh') || roleLower.includes('student') || roleLower === 'sv') {
      assignedRole = 'student';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let isValid = true;
    let errorMessage = '';

    if (!emailTrim || !emailRegex.test(emailTrim)) {
      isValid = false;
      errorMessage = 'Email không đúng định dạng';
    } else if (!fullNameTrim) {
      isValid = false;
      errorMessage = 'Họ và tên không được để trống';
    } else if (!assignedRole) {
      isValid = false;
      errorMessage = 'Vai trò phải là Sinh viên hoặc Giảng viên';
    }

    const parsed: ParsedCSVRow = {
      index: r,
      rawEmail,
      rawFullName,
      rawRole,
      emailNormalized: emailTrim,
      fullName: fullNameTrim,
      assignedRole,
      isValid,
      errorMessage: isValid ? undefined : errorMessage,
    };

    if (isValid) {
      parsedValid.push(parsed);
    } else {
      parsedInvalid.push(parsed);
    }
  }

  return {
    totalRows: rows.length - 1,
    validRows: parsedValid,
    invalidRows: parsedInvalid,
    headers: rows[0],
  };
}
