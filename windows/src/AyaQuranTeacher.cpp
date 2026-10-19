/**
 * @file AyaQuranTeacher.cpp
 * @description Native Windows Desktop Host for Aya AI Quran Teacher.
 * 
 * Embeds a secure, lightweight localhost HTTP loopback server (Winsock2) to serve local
 * production assets (dist/) with proper MIME types and WebAssembly multi-threading headers
 * (COOP/COEP). Launches in isolated, standalone window mode without browser address bar.
 * Persists student progress and IndexedDB in %APPDATA%\AyaQuranTeacher\Data.
 */

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <shlobj.h>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <thread>
#include <atomic>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "user32.lib")

static std::atomic<bool> g_running(true);
static std::wstring g_distPath;
static int g_serverPort = 0;

std::wstring GetExeDirectory() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(NULL, path, MAX_PATH);
    std::wstring str(path);
    size_t pos = str.find_last_of(L"\\/");
    return (pos != std::wstring::npos) ? str.substr(0, pos) : L"";
}

bool FileExists(const std::wstring& path) {
    DWORD attr = GetFileAttributesW(path.c_str());
    return (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY));
}

bool DirExists(const std::wstring& path) {
    DWORD attr = GetFileAttributesW(path.c_str());
    return (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY));
}

std::string GetMimeType(const std::wstring& path) {
    size_t dot = path.find_last_of(L".");
    if (dot == std::wstring::npos) return "application/octet-stream";
    std::wstring ext = path.substr(dot);
    for (auto& c : ext) c = towlower(c);

    if (ext == L".html" || ext == L".htm") return "text/html; charset=utf-8";
    if (ext == L".js" || ext == L".mjs")   return "application/javascript; charset=utf-8";
    if (ext == L".css")                    return "text/css; charset=utf-8";
    if (ext == L".wasm")                   return "application/wasm";
    if (ext == L".json")                   return "application/json; charset=utf-8";
    if (ext == L".svg")                    return "image/svg+xml";
    if (ext == L".png")                    return "image/png";
    if (ext == L".jpg" || ext == L".jpeg") return "image/jpeg";
    if (ext == L".ico")                    return "image/x-icon";
    if (ext == L".onnx")                   return "application/octet-stream";
    if (ext == L".wav")                    return "audio/wav";
    if (ext == L".mp3")                    return "audio/mpeg";
    if (ext == L".woff2")                  return "font/woff2";
    if (ext == L".woff")                   return "font/woff";
    if (ext == L".ttf")                    return "font/ttf";
    return "application/octet-stream";
}

void HandleClient(SOCKET clientSocket) {
    char buffer[4096];
    int bytesReceived = recv(clientSocket, buffer, sizeof(buffer) - 1, 0);
    if (bytesReceived <= 0) {
        closesocket(clientSocket);
        return;
    }
    buffer[bytesReceived] = '\0';

    std::string request(buffer);
    std::istringstream reqStream(request);
    std::string method, rawUri, protocol;
    reqStream >> method >> rawUri >> protocol;

    if (method != "GET" && method != "HEAD") {
        std::string response = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n";
        send(clientSocket, response.c_str(), (int)response.size(), 0);
        closesocket(clientSocket);
        return;
    }

    // Strip query string and hash
    size_t qPos = rawUri.find('?');
    std::string uriPath = (qPos != std::string::npos) ? rawUri.substr(0, qPos) : rawUri;
    if (uriPath == "/" || uriPath.empty()) {
        uriPath = "/index.html";
    }

    // Convert URI path to relative file path
    std::wstring relPath;
    for (char c : uriPath) {
        if (c == '/') relPath += L'\\';
        else relPath += (wchar_t)c;
    }

    std::wstring fullPath = g_distPath + relPath;

    // SPA Fallback: if file doesn't exist and not in /assets, serve /index.html
    if (!FileExists(fullPath)) {
        if (uriPath.find("/assets/") == std::string::npos) {
            fullPath = g_distPath + L"\\index.html";
        }
    }

    std::ifstream file(fullPath, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        std::string notFound = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
        send(clientSocket, notFound.c_str(), (int)notFound.size(), 0);
        closesocket(clientSocket);
        return;
    }

    std::streamsize fileSize = file.tellg();
    file.seekg(0, std::ios::beg);

    std::string mimeType = GetMimeType(fullPath);

    std::ostringstream headerStream;
    headerStream << "HTTP/1.1 200 OK\r\n";
    headerStream << "Content-Type: " << mimeType << "\r\n";
    headerStream << "Content-Length: " << fileSize << "\r\n";
    headerStream << "Connection: close\r\n";
    headerStream << "Access-Control-Allow-Origin: *\r\n";
    headerStream << "Cross-Origin-Opener-Policy: same-origin\r\n";
    headerStream << "Cross-Origin-Embedder-Policy: require-corp\r\n";
    headerStream << "Cache-Control: public, max-age=3600\r\n";
    headerStream << "\r\n";

    std::string headers = headerStream.str();
    send(clientSocket, headers.c_str(), (int)headers.size(), 0);

    if (method == "GET") {
        char sendBuf[8192];
        while (file.read(sendBuf, sizeof(sendBuf)) || file.gcount() > 0) {
            std::streamsize count = file.gcount();
            send(clientSocket, sendBuf, (int)count, 0);
        }
    }

    file.close();
    closesocket(clientSocket);
}

void RunServer() {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return;

    SOCKET listenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSocket == INVALID_SOCKET) {
        WSACleanup();
        return;
    }

    sockaddr_in serverAddr;
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_addr.s_addr = inet_addr("127.0.0.1");
    serverAddr.sin_port = htons(0); // Port 0 assigns random available port

    if (bind(listenSocket, (sockaddr*)&serverAddr, sizeof(serverAddr)) == SOCKET_ERROR) {
        closesocket(listenSocket);
        WSACleanup();
        return;
    }

    sockaddr_in boundAddr;
    int boundLen = sizeof(boundAddr);
    getsockname(listenSocket, (sockaddr*)&boundAddr, &boundLen);
    g_serverPort = ntohs(boundAddr.sin_port);

    if (listen(listenSocket, SOMAXCONN) == SOCKET_ERROR) {
        closesocket(listenSocket);
        WSACleanup();
        return;
    }

    // Set non-blocking timeout
    DWORD timeout = 1000;
    setsockopt(listenSocket, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));

    while (g_running) {
        SOCKET clientSocket = accept(listenSocket, NULL, NULL);
        if (clientSocket != INVALID_SOCKET) {
            std::thread(HandleClient, clientSocket).detach();
        }
    }

    closesocket(listenSocket);
    WSACleanup();
}

std::wstring FindEdgePath() {
    std::wstring candidates[] = {
        L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    };
    for (const auto& path : candidates) {
        if (FileExists(path)) return path;
    }
    return L"";
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, PWSTR pCmdLine, int nCmdShow) {
    std::wstring exeDir = GetExeDirectory();

    // Check possible dist paths: installed alongside exe, or in dev tree
    std::wstring distCandidates[] = {
        exeDir + L"\\dist",
        exeDir + L"\\..\\dist",
        exeDir + L"\\..\\..\\dist",
        L"F:\\quran\\dist"
    };

    for (const auto& path : distCandidates) {
        if (DirExists(path) && FileExists(path + L"\\index.html")) {
            g_distPath = path;
            break;
        }
    }

    if (g_distPath.empty()) {
        MessageBoxW(NULL, L"تعذر العثور على ملفات التطبيق (dist/index.html). يرجى تشغيل مثبت البرنامج.", L"خطأ في التشغيل", MB_ICONERROR);
        return 1;
    }

    // Start background loopback HTTP server
    std::thread serverThread(RunServer);

    // Wait until server port is allocated
    for (int i = 0; i < 50 && g_serverPort == 0; i++) {
        Sleep(50);
    }

    if (g_serverPort == 0) {
        g_running = false;
        serverThread.join();
        MessageBoxW(NULL, L"تعذر تشغيل خادم التطبيق المحلي الداخلي.", L"خطأ", MB_ICONERROR);
        return 1;
    }

    std::wstring edgePath = FindEdgePath();
    if (edgePath.empty()) {
        g_running = false;
        serverThread.join();
        MessageBoxW(NULL, L"يتطلب التطبيق وجود Microsoft Edge للعمل دون اتصال.", L"متطلب تشغيل", MB_ICONWARNING);
        return 1;
    }

    // User data directory for isolated persistent IndexedDB & credentials
    wchar_t appData[MAX_PATH];
    SHGetFolderPathW(NULL, CSIDL_APPDATA, NULL, 0, appData);
    std::wstring userDataDir = std::wstring(appData) + L"\\AyaQuranTeacher\\Data";
    CreateDirectoryW((std::wstring(appData) + L"\\AyaQuranTeacher").c_str(), NULL);
    CreateDirectoryW(userDataDir.c_str(), NULL);

    std::wstring appUrl = L"http://127.0.0.1:" + std::to_wstring(g_serverPort) + L"/?platform=windows";
    std::wstring cmdLine = L"\"" + edgePath + L"\" --app=\"" + appUrl + L"\" --user-data-dir=\"" + userDataDir + L"\" --window-size=1280,850";

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
    cmdBuf.push_back(0);

    if (CreateProcessW(NULL, cmdBuf.data(), NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
        // Wait for the desktop app window to close
        WaitForSingleObject(pi.hProcess, INFINITE);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        MessageBoxW(NULL, L"فشل بدء نافذة التطبيق المستقلة.", L"خطأ", MB_ICONERROR);
    }

    g_running = false;
    // Connect to server port to unblock accept() and terminate thread gracefully
    SOCKET unblock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in serverAddr;
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_addr.s_addr = inet_addr("127.0.0.1");
    serverAddr.sin_port = htons(g_serverPort);
    connect(unblock, (sockaddr*)&serverAddr, sizeof(serverAddr));
    closesocket(unblock);

    serverThread.join();
    return 0;
}
