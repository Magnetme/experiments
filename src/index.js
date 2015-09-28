import angular from 'angular';

export default angular.module("mm.experiments", [])
	.factory('experiments', ($q) => {
		'ngInject';

		const variations = new Map();
		return {
			/**
			 * Sets a variation for a certain experiment.
			 */
			setVariation(name, variation) {
				variations.set(name, $q.resolve(variation));
			},
			/**
			 * Registers a promise for a certain variation.
			 */
			setDeferredVariation(name, deferred) {
				variations.set(name, deferred);
			},
			/**
			 * Returns a promise that resolves to a variation
			 */
			getVariation(name) {
				return variations.get(name);
			}
		};
	})
	.factory('googleExperiments', ($q, $rootScope) => {
		'ngInject';
		const experiments = new Map();
		const resolvers = new Map();
		const promises = new Map();

		window.mmGoogleExperimentCallback = (id, variation) => {
			$rootScope.$apply(() => {
				//We cache the result as well as resolve the promise for the original call
				experiments.set(id, variation);
				if (resolvers.has(id)) {
					resolvers.get(id)(variation);
					resolvers.delete(id);
				}
			});
		};

		return {
			getVariation: async function(id, defaultVariation = 0) {
				//Short circuit from cache if possible
				if (experiments.has(id)) {
					return experiments.get(id);
				}
				//Short circuit from promise cache if possible.
				//This is to prevent multiple iframes from being inserted when the first one hasn't finished
				//loading yet
				if (promises.has(id)) {
					return await promises.get(id);
				}

				//If we don't have the id yet we create a new invisible iframe that can get the variation for a given
				//experiment. We need this iframe because the api doesn't allow us to choose the variation
				//for a given id, we can only do so for the id specified in the query parameter.
				//It uses the global mmGoogleExperimentCallback callback to return the experiment back to the application
				const promise = $q((resolve, reject) => {
					resolvers.set(id, resolve);
					const baseUrl = 'https://www.google-analytics.com/cx/api.js?experiment=';
					const content = `
						<body>
							<div>BaseUrl: ${baseUrl}
							id: ${id}</div>
							<script src="${baseUrl}${id}"></script>
							<script>
								var variation;
								//because ad-blockers
								if (typeof cxApi !== "undefined") {
									variation = cxApi.chooseVariation();
								} else {
									variation = ${defaultVariation};
								}
								window.parent.mmGoogleExperimentCallback("${id}", variation);
							</script>
						</body>
					`;
					const variationFrame = document.createElement('iframe');
					document.body.appendChild(variationFrame);
					variationFrame.style.display = 'none';
					const variationDocument = variationFrame.contentWindow.document;
					variationDocument.open();
					variationDocument.write(content);
					variationDocument.close();
				});
				promises.set(id, promise);
				return await promise;
			}
		};
	})
	.directive('mmExperiment', (experiments) => {
		'ngInject';
		return {
			restrict : 'A',
			require : 'mmExperiment',
			controller($q) {
				'ngInject';
				let resolveExperiment;
				/**
				 * Promise that resolves to the experiment.
				 *
				 * We need to do this with a promise since we can only resolve the experiment in the link
				 * function, which runs later than this and later than the child directives (e.g. mm-variation)
				 */
				this.experiment = $q(resolve => {
					resolveExperiment = resolve;
				});
				/**
				 * Internal method to set the experiment name from the link function
				 */
				this._setExperiment = (experiment) => {
					resolveExperiment(experiment);
				};
				/**
				 * Returns a promise that resolves to the variation chosen
				 */
				this.getVariation = async function() {
					const experiment = await this.experiment;
					return await experiments.getVariation(experiment);
				};
			},
			link : async function(scope, el, attrs, ctrl) {
				ctrl._setExperiment(attrs.mmExperiment);
				scope.$variation = await experiments.getVariation(attrs.mmExperiment);
			}
		}
	})
	.directive('mmVariation', () => {
		return {
			restrict : 'A',
			require : '^mmExperiment',
			transclude : 'element',
			priority: 599, //1 less than ng-if
			terminal : true,
			link: async function(scope, el, attrs, experimentCtrl, $transclude) {
				let myVariation = attrs.mmVariation;
				const chosen = await experimentCtrl.getVariation();
				//If the chosen variation is a number then we convert the given variation to a number too.
				//We always get it as a string, so we need to do this extra step.
				if (Number.isFinite(chosen)) {
					myVariation = Number(myVariation);
				}
				//If we're the chosen one then we can replace the comment placeholder with the actual content
				if (myVariation === chosen) {
					$transclude(clone => {
						el.replaceWith(clone);
					});
				}
			}
		}
	});

