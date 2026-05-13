import NProgress from 'nprogress';

NProgress.configure({ showSpinner: false, speed: 300, minimum: 0.08 });

export const startLoading = () => NProgress.start();
export const stopLoading = () => NProgress.done();
