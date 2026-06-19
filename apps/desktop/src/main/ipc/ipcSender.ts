export function isMainWindowSender(
  senderId: number,
  mainWindowWebContentsId: number | null | undefined,
): boolean {
  return mainWindowWebContentsId !== null && mainWindowWebContentsId !== undefined
    ? senderId === mainWindowWebContentsId
    : false;
}
