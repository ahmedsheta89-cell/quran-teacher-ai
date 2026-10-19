/**
 * @file AyaQuranTeacherInstaller.cpp
 * @description Standalone Windows Setup Installer for Aya AI Quran Teacher.
 * 
 * Installs the unified application to %LOCALAPPDATA%\Programs\AyaQuranTeacher,
 * copies bundled dist/ assets, creates Desktop and Start Menu shortcuts,
 * and registers in Windows Add/Remove Programs registry.
 */

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "user32.lib")

std::wstring GetCurrentDir() {
    wchar_t buf[MAX_PATH];
    GetModuleFileNameW(NULL, buf, MAX_PATH);
    std::wstring s(buf);
    size_t pos = s.find_last_of(L"\\/");
    return (pos != std::wstring::npos) ? s.substr(0, pos) : L"";
}

bool CreateDirRecursive(const std::wstring& path) {
    if (CreateDirectoryW(path.c_str(), NULL) || GetLastError() == ERROR_ALREADY_EXISTS) {
        return true;
    }
    size_t pos = path.find_last_of(L"\\/");
    if (pos == std::wstring::npos) return false;
    if (!CreateDirRecursive(path.substr(0, pos))) return false;
    return CreateDirectoryW(path.c_str(), NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
}

void CopyDirectory(const std::wstring& src, const std::wstring& dst) {
    CreateDirRecursive(dst);
    WIN32_FIND_DATAW fd;
    HANDLE hFind = FindFirstFileW((src + L"\\*").c_str(), &fd);
    if (hFind == INVALID_HANDLE_VALUE) return;

    do {
        if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
        std::wstring sChild = src + L"\\" + fd.cFileName;
        std::wstring dChild = dst + L"\\" + fd.cFileName;

        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            CopyDirectory(sChild, dChild);
        } else {
            CopyFileW(sChild.c_str(), dChild.c_str(), FALSE);
        }
    } while (FindNextFileW(hFind, &fd));

    FindClose(hFind);
}

bool CreateShortcut(const std::wstring& shortcutPath, const std::wstring& targetPath, const std::wstring& description, const std::wstring& workingDir) {
    HRESULT hr = CoInitialize(NULL);
    bool success = false;
    IShellLinkW* psl = NULL;

    if (SUCCEEDED(CoCreateInstance(CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, IID_IShellLinkW, (void**)&psl))) {
        psl->SetPath(targetPath.c_str());
        psl->SetDescription(description.c_str());
        psl->SetWorkingDirectory(workingDir.c_str());

        IPersistFile* ppf = NULL;
        if (SUCCEEDED(psl->QueryInterface(IID_IPersistFile, (void**)&ppf))) {
            if (SUCCEEDED(ppf->Save(shortcutPath.c_str(), TRUE))) {
                success = true;
            }
            ppf->Release();
        }
        psl->Release();
    }
    CoUninitialize();
    return success;
}

void RegisterUninstall(const std::wstring& installDir) {
    HKEY hKey;
    const wchar_t* subKey = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AyaQuranTeacher";
    if (RegCreateKeyExW(HKEY_CURRENT_USER, subKey, 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS) {
        std::wstring displayName = L"معلم القرآن الرقمي - Aya AI Quran Teacher";
        std::wstring displayVersion = L"3.2.0";
        std::wstring publisher = L"Aya AI Quran Foundation";
        std::wstring exePath = installDir + L"\\AyaQuranTeacher.exe";
        std::wstring uninstallCmd = L"\"" + installDir + L"\\Uninstall.cmd\"";

        RegSetValueExW(hKey, L"DisplayName", 0, REG_SZ, (const BYTE*)displayName.c_str(), (DWORD)((displayName.size() + 1) * sizeof(wchar_t)));
        RegSetValueExW(hKey, L"DisplayVersion", 0, REG_SZ, (const BYTE*)displayVersion.c_str(), (DWORD)((displayVersion.size() + 1) * sizeof(wchar_t)));
        RegSetValueExW(hKey, L"Publisher", 0, REG_SZ, (const BYTE*)publisher.c_str(), (DWORD)((publisher.size() + 1) * sizeof(wchar_t)));
        RegSetValueExW(hKey, L"InstallLocation", 0, REG_SZ, (const BYTE*)installDir.c_str(), (DWORD)((installDir.size() + 1) * sizeof(wchar_t)));
        RegSetValueExW(hKey, L"DisplayIcon", 0, REG_SZ, (const BYTE*)exePath.c_str(), (DWORD)((exePath.size() + 1) * sizeof(wchar_t)));
        RegSetValueExW(hKey, L"UninstallString", 0, REG_SZ, (const BYTE*)uninstallCmd.c_str(), (DWORD)((uninstallCmd.size() + 1) * sizeof(wchar_t)));
        RegCloseKey(hKey);
    }
}

std::string ToUtf8(const std::wstring& wstr) {
    if (wstr.empty()) return std::string();
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), NULL, 0, NULL, NULL);
    std::string str(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), &str[0], size, NULL, NULL);
    return str;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, PWSTR pCmdLine, int nCmdShow) {
    // 0. Parse Command Line for Silent Flag
    bool isSilent = false;
    if (pCmdLine) {
        std::wstring cmd(pCmdLine);
        if (cmd.find(L"/S") != std::wstring::npos ||
            cmd.find(L"/s") != std::wstring::npos ||
            cmd.find(L"/silent") != std::wstring::npos ||
            cmd.find(L"--silent") != std::wstring::npos) {
            isSilent = true;
        }
    }

    std::wstring installerDir = GetCurrentDir();
    
    // Resolve executable source from candidates
    std::wstring exeCandidates[] = {
        installerDir + L"\\AyaQuranTeacher.exe",
        installerDir + L"\\bin\\AyaQuranTeacher.exe",
        installerDir + L"\\..\\bin\\AyaQuranTeacher.exe"
    };
    std::wstring exeSrc = L"";
    for (const auto& p : exeCandidates) {
        if (GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES) {
            exeSrc = p;
            break;
        }
    }

    // Resolve dist directory from candidates
    std::wstring distCandidates[] = {
        installerDir + L"\\dist",
        installerDir + L"\\..\\dist",
        installerDir + L"\\..\\..\\dist"
    };
    std::wstring distSrc = L"";
    for (const auto& p : distCandidates) {
        if (GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES) {
            distSrc = p;
            break;
        }
    }

    // Verify source files exist
    if (exeSrc.empty() || GetFileAttributesW(exeSrc.c_str()) == INVALID_FILE_ATTRIBUTES) {
        if (!isSilent) MessageBoxW(NULL, L"حزمة التثبيت غير مكتملة: الملف التنفيذي AyaQuranTeacher.exe مفقود.", L"خطأ في التثبيت", MB_ICONERROR);
        return 1;
    }

    if (distSrc.empty() || GetFileAttributesW(distSrc.c_str()) == INVALID_FILE_ATTRIBUTES) {
        if (!isSilent) MessageBoxW(NULL, L"حزمة التثبيت غير مكتملة: مجلد dist مفقود.", L"خطأ في التثبيت", MB_ICONERROR);
        return 1;
    }

    // Verify ONNX AI speech model exists in dist
    std::wstring onnxSrc = distSrc + L"\\models\\saboorhsn\\quran-stt-int8.onnx";
    if (GetFileAttributesW(onnxSrc.c_str()) == INVALID_FILE_ATTRIBUTES) {
        if (!isSilent) MessageBoxW(NULL, L"حزمة التثبيت غير مكتملة: ملف نموذج الذكاء الاصطناعي ONNX مفقود في dist/models.", L"خطأ في التثبيت", MB_ICONERROR);
        return 1;
    }

    // Check Microsoft Edge presence
    std::wstring edgeCandidates[] = {
        L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    };
    bool edgeFound = false;
    for (const auto& ep : edgeCandidates) {
        if (GetFileAttributesW(ep.c_str()) != INVALID_FILE_ATTRIBUTES) {
            edgeFound = true;
            break;
        }
    }
    if (!edgeFound && !isSilent) {
        MessageBoxW(NULL, L"تنبيه: لم يتم العثور على متصفح Microsoft Edge. التطبيق يحتاج متصفح حديث لتشغيل واجهة الويب المحلية.", L"تنبيه المتصفح", MB_ICONWARNING);
    }

    // Resolve %LOCALAPPDATA%\Programs\AyaQuranTeacher
    wchar_t localAppPath[MAX_PATH];
    SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppPath);
    std::wstring targetDir = std::wstring(localAppPath) + L"\\Programs\\AyaQuranTeacher";
    CreateDirRecursive(targetDir);

    // 1. Copy Application Executable
    std::wstring targetExe = targetDir + L"\\AyaQuranTeacher.exe";
    CopyFileW(exeSrc.c_str(), targetExe.c_str(), FALSE);

    // 2. Copy Bundled dist/ Directory
    std::wstring targetDist = targetDir + L"\\dist";
    CopyDirectory(distSrc, targetDist);

    // 3. Create Desktop Shortcut
    wchar_t desktopPath[MAX_PATH];
    SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, desktopPath);
    std::wstring desktopLnk = std::wstring(desktopPath) + L"\\Aya Quran Teacher.lnk";
    CreateShortcut(desktopLnk, targetExe, L"معلّم القرآن الرقمي - منصة التسميع والتجويد الذكية", targetDir);

    // 4. Create Start Menu Shortcut
    wchar_t programsPath[MAX_PATH];
    SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, programsPath);
    std::wstring startMenuFolder = std::wstring(programsPath) + L"\\Aya Quran Teacher";
    CreateDirRecursive(startMenuFolder);
    std::wstring startMenuLnk = startMenuFolder + L"\\Aya Quran Teacher.lnk";
    CreateShortcut(startMenuLnk, targetExe, L"معلّم القرآن الرقمي - منصة التسميع والتجويد الذكية", targetDir);

    // 5. Generate Uninstall Script (Guaranteed Preservation of %APPDATA%\AyaQuranTeacher\Data)
    std::wstring uninstCmdPath = targetDir + L"\\Uninstall.cmd";
    std::ofstream uninstFile(ToUtf8(uninstCmdPath), std::ios::binary);
    if (uninstFile.is_open()) {
        uninstFile << "@echo off\r\n";
        uninstFile << "chcp 65001 >nul\r\n";
        uninstFile << "echo Removing Aya AI Quran Teacher...\r\n";
        uninstFile << "taskkill /f /im AyaQuranTeacher.exe >nul 2>&1\r\n";
        uninstFile << "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AyaQuranTeacher\" /f >nul 2>&1\r\n";
        uninstFile << "del /q \"" << ToUtf8(desktopLnk) << "\" >nul 2>&1\r\n";
        uninstFile << "rmdir /s /q \"" << ToUtf8(startMenuFolder) << "\" >nul 2>&1\r\n";
        uninstFile << "echo [Data Preservation Invariant] Local student data in %APPDATA%\\AyaQuranTeacher\\Data is preserved.\r\n";
        uninstFile << "echo ping 127.0.0.1 -n 2 ^>nul > \"%TEMP%\\aya_cleanup.cmd\"\r\n";
        uninstFile << "echo rmdir /s /q \"" << ToUtf8(targetDir) << "\" >> \"%TEMP%\\aya_cleanup.cmd\"\r\n";
        uninstFile << "echo del \"%%~f0\" >> \"%TEMP%\\aya_cleanup.cmd\"\r\n";
        uninstFile << "cd %TEMP%\r\n";
        uninstFile << "start \"\" /b cmd /c \"%TEMP%\\aya_cleanup.cmd\"\r\n";
        uninstFile << "exit /b 0\r\n";
        uninstFile.close();
    }

    // 6. Register in Windows Registry
    RegisterUninstall(targetDir);

    if (!isSilent) {
        MessageBoxW(NULL,
            L"تم تثبيت برنامج «معلّم القرآن الرقمي» بنجاح على نظام Windows!\r\n\r\n"
            L"تم إنشاء اختصار على سطح المكتب وقائمة ابدأ.\r\n"
            L"البرنامج يعمل محلياً دون الحاجة لاتصال بالإنترنت.",
            L"اكتمال التثبيت", MB_ICONINFORMATION);
    }

    return 0;
}
